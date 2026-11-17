use crate::error::JackError;
use data_encoding::BASE32_NOPAD;
use ed25519_dalek::pkcs8::{EncodePrivateKey, EncodePublicKey};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use rcgen::{CertificateParams, KeyPair};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceId(pub String);

impl DeviceId {
    pub fn from_pubkey(pk: &[u8; 32]) -> Self {
        let hash = Sha256::digest(pk);
        let short = BASE32_NOPAD.encode(&hash[..16]).to_lowercase();
        Self(format!("jack:ed25519:{}", short))
    }

    pub fn parse(raw: &str) -> Result<Self, JackError> {
        let Some(rest) = raw.strip_prefix("jack:ed25519:") else {
            return Err(JackError::InvalidInput("invalid DeviceId prefix".into()));
        };
        if rest.len() != 26 || !rest.chars().all(|c| matches!(c, 'a'..='z' | '2'..='7')) {
            return Err(JackError::InvalidInput("invalid DeviceId body".into()));
        }
        Ok(Self(raw.to_string()))
    }
}

pub struct DeviceIdentity {
    signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub device_id: DeviceId,
    pub cert_der: CertificateDer<'static>,
    pkcs8_der: Zeroizing<Vec<u8>>,
}

impl fmt::Debug for DeviceIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceIdentity")
            .field("device_id", &self.device_id)
            .field("signing_key", &"[REDACTED]")
            .finish()
    }
}

impl DeviceIdentity {
    pub fn generate() -> Result<Self, JackError> {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        Self::from_signing_key(signing_key)
    }

    pub fn from_signing_key(signing_key: SigningKey) -> Result<Self, JackError> {
        let verifying_key = signing_key.verifying_key();
        let pk_bytes = verifying_key.to_bytes();
        let device_id = DeviceId::from_pubkey(&pk_bytes);

        let pkcs8 = signing_key
            .to_pkcs8_der()
            .map_err(|e| JackError::Io(format!("pkcs8 encode failed: {}", e)))?;
        let pkcs8_der = Zeroizing::new(pkcs8.as_bytes().to_vec());

        let key_pair = KeyPair::from_pkcs8_der_and_sign_algo(
            &PrivatePkcs8KeyDer::from(pkcs8_der.as_slice()),
            &rcgen::PKCS_ED25519,
        )
        .map_err(|e| JackError::Io(format!("rcgen keypair failed: {}", e)))?;

        let mut params = CertificateParams::new(vec![device_id.0.clone()])
            .map_err(|e| JackError::Io(format!("cert params failed: {}", e)))?;
        params.distinguished_name = rcgen::DistinguishedName::new();
        let cert = params
            .self_signed(&key_pair)
            .map_err(|e| JackError::Io(format!("self-signed cert failed: {}", e)))?;

        Ok(Self {
            signing_key,
            verifying_key,
            device_id,
            cert_der: CertificateDer::from(cert.der().to_vec()),
            pkcs8_der,
        })
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.verifying_key.to_bytes()
    }

    pub fn spki_der(&self) -> Result<Vec<u8>, JackError> {
        let doc = self
            .verifying_key
            .to_public_key_der()
            .map_err(|e| JackError::Io(format!("spki encode failed: {}", e)))?;
        Ok(doc.as_bytes().to_vec())
    }

    pub fn private_key_der(&self) -> PrivateKeyDer<'static> {
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.pkcs8_der.to_vec()))
    }

    pub fn clone_signing_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.signing_key.to_bytes())
    }
}

pub trait Keystore: Send + Sync {
    fn load_or_create(&self, label: &str) -> Result<DeviceIdentity, JackError>;
}

/// Test-only in-memory keystore (never writes plaintext private keys to disk).
#[derive(Default, Clone)]
pub struct InMemoryTestKeystore {
    keys: Arc<Mutex<HashMap<String, Zeroizing<[u8; 32]>>>>,
}

impl Keystore for InMemoryTestKeystore {
    fn load_or_create(&self, label: &str) -> Result<DeviceIdentity, JackError> {
        let mut guard = self
            .keys
            .lock()
            .map_err(|_| JackError::KeystoreUnavailable("keystore mutex poisoned".into()))?;
        if let Some(seed) = guard.get(label) {
            let sk = SigningKey::from_bytes(seed);
            return DeviceIdentity::from_signing_key(sk);
        }
        let id = DeviceIdentity::generate()?;
        guard.insert(label.to_string(), id.clone_signing_bytes());
        Ok(id)
    }
}

/// Fail-closed keystore simulating missing Linux Secret Service / DPAPI.
pub struct FailClosedKeystore;

impl Keystore for FailClosedKeystore {
    fn load_or_create(&self, _label: &str) -> Result<DeviceIdentity, JackError> {
        Err(JackError::KeystoreUnavailable(
            "OS keystore unavailable; refusing silent plaintext key fallback".into(),
        ))
    }
}

#[cfg(windows)]
pub struct WindowsDpapiKeystore {
    dir: std::path::PathBuf,
}

#[cfg(windows)]
impl WindowsDpapiKeystore {
    pub fn new(dir: std::path::PathBuf) -> Self {
        Self { dir }
    }

    fn key_path(&self, label: &str) -> Result<std::path::PathBuf, JackError> {
        let safe: String = label
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if safe.is_empty() {
            return Err(JackError::InvalidInput("empty keystore label".into()));
        }
        Ok(self.dir.join(format!("{}.dpapi", safe)))
    }
}

#[cfg(windows)]
impl Keystore for WindowsDpapiKeystore {
    fn load_or_create(&self, label: &str) -> Result<DeviceIdentity, JackError> {
        use std::fs;
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };

        if let Ok(meta) = fs::symlink_metadata(&self.dir) {
            if meta.file_type().is_symlink() {
                return Err(JackError::KeystoreUnavailable(
                    "refusing symlinked keystore directory".into(),
                ));
            }
        }
        fs::create_dir_all(&self.dir)
            .map_err(|e| JackError::KeystoreUnavailable(format!("keystore dir failed: {}", e)))?;
        let path = self.key_path(label)?;
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() {
                return Err(JackError::KeystoreUnavailable(
                    "refusing symlinked dpapi key file".into(),
                ));
            }
            let encrypted = fs::read(&path)
                .map_err(|e| JackError::KeystoreUnavailable(format!("dpapi read failed: {}", e)))?;
            let in_blob = CRYPT_INTEGER_BLOB {
                cbData: u32::try_from(encrypted.len())
                    .map_err(|_| JackError::KeystoreUnavailable("dpapi blob too large".into()))?,
                pbData: encrypted.as_ptr() as *mut u8,
            };
            let mut out_blob = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = unsafe {
                CryptUnprotectData(
                    &in_blob,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out_blob,
                )
            };
            if ok == 0 || out_blob.pbData.is_null() {
                return Err(JackError::KeystoreUnavailable(
                    "DPAPI CryptUnprotectData failed".into(),
                ));
            }
            let slice =
                unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) };
            let mut seed = Zeroizing::new([0u8; 32]);
            let valid_len = slice.len() == 32;
            if valid_len {
                seed.copy_from_slice(slice);
            }
            unsafe {
                std::ptr::write_bytes(out_blob.pbData, 0, out_blob.cbData as usize);
                let _ = LocalFree(out_blob.pbData as _);
            }
            if !valid_len {
                return Err(JackError::KeystoreUnavailable(
                    "corrupted DPAPI key length".into(),
                ));
            }
            let sk = SigningKey::from_bytes(&seed);
            return DeviceIdentity::from_signing_key(sk);
        }

        let id = DeviceIdentity::generate()?;
        let seed = id.clone_signing_bytes();
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: 32,
            pbData: seed.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &in_blob,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };
        if ok == 0 || out_blob.pbData.is_null() {
            return Err(JackError::KeystoreUnavailable(
                "DPAPI CryptProtectData failed".into(),
            ));
        }
        let protected = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        unsafe {
            let _ = LocalFree(out_blob.pbData as _);
        }
        let tmp = self.dir.join(format!(".{}.dpapi.tmp", label));
        fs::write(&tmp, &protected)
            .map_err(|e| JackError::KeystoreUnavailable(format!("dpapi write failed: {}", e)))?;
        fs::rename(&tmp, &path)
            .map_err(|e| JackError::KeystoreUnavailable(format!("dpapi rename failed: {}", e)))?;
        Ok(id)
    }
}

pub fn platform_keystore(dir: &std::path::Path) -> Box<dyn Keystore> {
    #[cfg(windows)]
    {
        Box::new(WindowsDpapiKeystore::new(dir.to_path_buf()))
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Box::new(InMemoryTestKeystore::default())
    }
}

/// Extract the 32-byte Ed25519 raw public key from the parsed ASN.1 SubjectPublicKeyInfo
/// of an X.509 certificate DER (never via substring scanning).
pub fn extract_ed25519_pubkey_from_cert(cert_der: &[u8]) -> Result<[u8; 32], JackError> {
    use x509_parser::prelude::*;
    let (rem, cert) = X509Certificate::from_der(cert_der)
        .map_err(|_| JackError::InvalidInput("invalid X.509 DER certificate".into()))?;
    if !rem.is_empty() {
        return Err(JackError::InvalidInput(
            "trailing bytes after X.509 certificate".into(),
        ));
    }
    let spki = cert.public_key();
    if spki.algorithm.algorithm.to_id_string() != "1.3.101.112" {
        return Err(JackError::InvalidInput(
            "certificate SPKI is not Ed25519".into(),
        ));
    }
    let pk_bytes = spki.subject_public_key.data.as_ref();
    let pk: [u8; 32] = pk_bytes
        .try_into()
        .map_err(|_| JackError::InvalidInput("invalid Ed25519 public key length in SPKI".into()))?;
    VerifyingKey::from_bytes(&pk)
        .map_err(|_| JackError::InvalidInput("invalid Ed25519 public key in SPKI".into()))?;
    Ok(pk)
}
