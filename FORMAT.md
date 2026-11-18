# Cue Vault file format — VLT1

All integers are unsigned, big-endian. The 52-byte header is authenticated as AES-GCM additional authenticated data.

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 4 | ASCII `VLT1` |
| 4 | 1 | Format version = 1 |
| 5 | 1 | KDF id = 1 (PBKDF2-HMAC-SHA-256) |
| 6 | 1 | Cipher id = 1 (AES-256-GCM) |
| 7 | 1 | Flags = 0 |
| 8 | 4 | PBKDF2 iteration count = 600000 |
| 12 | 16 | Random salt |
| 28 | 12 | Random GCM nonce |
| 40 | 8 | Ciphertext length, including the 16-byte GCM tag |
| 48 | 4 | Header length = 52 |
| 52 | N | AES-GCM ciphertext and tag |

The decrypted plaintext is a UTF-8 ZIP archive. Password text is normalized to Unicode NFC before UTF-8 encoding and PBKDF2. A new random salt and nonce are used for every vault. The implementation rejects unsupported versions/parameters, invalid lengths, authentication failures, unsafe entry paths, duplicate case-insensitive names, more than 200 files, and total uncompressed files larger than 40 MiB.

This format is a prototype contract, not a public standard. Any separate implementation must test interoperability, including Unicode normalization, ZIP name encoding, byte order, AAD coverage, tag placement, and browser/OS storage behavior before using real data.
