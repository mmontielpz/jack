use crate::error::JackError;
use crate::identity::{extract_ed25519_pubkey_from_cert, DeviceIdentity};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    ClientConfig, DigitallySignedStruct, DistinguishedName, ServerConfig, SignatureScheme,
};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const ALPN_PAIR_V1: &[u8] = b"jack-pair/1";
pub const MAX_FRAME_BYTES: usize = 16 * 1024;
pub const IO_TIMEOUT: Duration = Duration::from_secs(5);

pub fn ensure_loopback(addr: SocketAddr) -> Result<(), JackError> {
    if !addr.ip().is_loopback() {
        return Err(JackError::LoopbackOnly(format!(
            "refusing non-loopback address {}",
            addr.ip()
        )));
    }
    Ok(())
}

pub fn configure_stream_timeouts(stream: &TcpStream) -> Result<(), JackError> {
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|e| JackError::Io(e.to_string()))?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|e| JackError::Io(e.to_string()))?;
    Ok(())
}

pub fn export_tls_channel_binding<S>(
    conn: &rustls::ConnectionCommon<S>,
) -> Result<[u8; 32], JackError> {
    let mut out = [0u8; 32];
    conn.export_keying_material(&mut out, b"EXPORTER-Channel-Binding", None)
        .map_err(|_| JackError::PakeBindingFailed)?;
    Ok(out)
}

pub fn write_bounded_frame<W: Write>(w: &mut W, payload: &[u8]) -> Result<(), JackError> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err(JackError::InvalidInput("frame exceeds 16 KiB bound".into()));
    }
    let len = (payload.len() as u32).to_be_bytes();
    w.write_all(&len)
        .map_err(|e| JackError::Io(e.to_string()))?;
    w.write_all(payload)
        .map_err(|e| JackError::Io(e.to_string()))?;
    w.flush().map_err(|e| JackError::Io(e.to_string()))?;
    Ok(())
}

pub fn read_bounded_frame<R: Read>(r: &mut R) -> Result<Vec<u8>, JackError> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)
        .map_err(|e| JackError::Io(e.to_string()))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(JackError::InvalidInput(
            "incoming frame exceeds 16 KiB bound".into(),
        ));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)
        .map_err(|e| JackError::Io(e.to_string()))?;
    Ok(buf)
}

/// Pre-trust pairing verifier:
/// Verifies TLS handshake signature and extracts the peer's Ed25519 public key into `observed_pk`.
/// NEVER grants trust on its own; trust requires channel-bound SPAKE2 + HMAC + Host human approval.
#[derive(Debug)]
struct PreTrustPairingVerifier {
    expected_pk: Option<[u8; 32]>,
    observed_pk: Arc<Mutex<Option<[u8; 32]>>>,
    supported: rustls::crypto::WebPkiSupportedAlgorithms,
}

impl PreTrustPairingVerifier {
    fn new(expected_pk: Option<[u8; 32]>, observed_pk: Arc<Mutex<Option<[u8; 32]>>>) -> Self {
        let provider = rustls::crypto::ring::default_provider();
        Self {
            expected_pk,
            observed_pk,
            supported: provider.signature_verification_algorithms,
        }
    }

    fn verify_ed25519_cert(&self, end_entity: &CertificateDer<'_>) -> Result<(), rustls::Error> {
        let pk = extract_ed25519_pubkey_from_cert(end_entity.as_ref()).map_err(|_| {
            rustls::Error::InvalidCertificate(rustls::CertificateError::BadEncoding)
        })?;
        if let Some(exp) = self.expected_pk {
            if pk != exp {
                return Err(rustls::Error::InvalidCertificate(
                    rustls::CertificateError::NotValidForName,
                ));
            }
        }
        if let Ok(mut guard) = self.observed_pk.lock() {
            *guard = Some(pk);
        }
        Ok(())
    }
}

impl ServerCertVerifier for PreTrustPairingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        self.verify_ed25519_cert(end_entity)?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(rustls::Error::PeerIncompatible(
            rustls::PeerIncompatible::Tls12NotOffered,
        ))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![SignatureScheme::ED25519]
    }
}

impl ClientCertVerifier for PreTrustPairingVerifier {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        self.verify_ed25519_cert(end_entity)?;
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(rustls::Error::PeerIncompatible(
            rustls::PeerIncompatible::Tls12NotOffered,
        ))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![SignatureScheme::ED25519]
    }
}

pub fn build_tls13_pairing_server_config(
    id: &DeviceIdentity,
    observed_client_pk: Arc<Mutex<Option<[u8; 32]>>>,
) -> Result<Arc<ServerConfig>, JackError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PreTrustPairingVerifier::new(None, observed_client_pk));
    let mut cfg = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| JackError::Io(e.to_string()))?
        .with_client_cert_verifier(verifier)
        .with_single_cert(vec![id.cert_der.clone()], id.private_key_der())
        .map_err(|e| JackError::Io(e.to_string()))?;
    cfg.alpn_protocols = vec![ALPN_PAIR_V1.to_vec()];
    Ok(Arc::new(cfg))
}

pub fn build_tls13_pairing_client_config(
    id: &DeviceIdentity,
    expected_host_pk: Option<[u8; 32]>,
    observed_host_pk: Arc<Mutex<Option<[u8; 32]>>>,
) -> Result<Arc<ClientConfig>, JackError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PreTrustPairingVerifier::new(
        expected_host_pk,
        observed_host_pk,
    ));
    let mut cfg = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| JackError::Io(e.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_client_auth_cert(vec![id.cert_der.clone()], id.private_key_der())
        .map_err(|e| JackError::Io(e.to_string()))?;
    cfg.alpn_protocols = vec![ALPN_PAIR_V1.to_vec()];
    Ok(Arc::new(cfg))
}

pub fn build_tls13_pinned_server_config(
    id: &DeviceIdentity,
    expected_client_pk: [u8; 32],
) -> Result<Arc<ServerConfig>, JackError> {
    let dummy = Arc::new(Mutex::new(None));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PreTrustPairingVerifier::new(
        Some(expected_client_pk),
        dummy,
    ));
    let mut cfg = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| JackError::Io(e.to_string()))?
        .with_client_cert_verifier(verifier)
        .with_single_cert(vec![id.cert_der.clone()], id.private_key_der())
        .map_err(|e| JackError::Io(e.to_string()))?;
    cfg.alpn_protocols = vec![ALPN_PAIR_V1.to_vec()];
    Ok(Arc::new(cfg))
}

pub fn build_tls13_pinned_client_config(
    id: &DeviceIdentity,
    expected_host_pk: [u8; 32],
) -> Result<Arc<ClientConfig>, JackError> {
    let dummy = Arc::new(Mutex::new(None));
    build_tls13_pairing_client_config(id, Some(expected_host_pk), dummy)
}
