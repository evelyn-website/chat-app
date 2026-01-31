/**
 * Mock for react-native-libsodium
 * Provides deterministic encryption functions for testing
 */

// Helper to create a deterministic Uint8Array from a seed string
function createDeterministicArray(seed, length) {
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = ((seed.charCodeAt(i % seed.length) + i) * 7) % 256;
  }
  return arr;
}

// Helper to convert Uint8Array to base64
function arrayToBase64(arr) {
  const bytes = String.fromCharCode.apply(null, arr);
  return Buffer.from(bytes, 'binary').toString('base64');
}

// Helper to convert base64 to Uint8Array
// eslint-disable-next-line no-unused-vars
function base64ToArray(b64) {
  const bytes = Buffer.from(b64, 'base64').toString('binary');
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return arr;
}

// Mock constants
const PUBLICKEYBYTES = 32;
const SECRETKEYBYTES = 32;
const SEEDBYTES = 32;
const NONCEBYTES = 24;
const BOXSEALBYTES = 48;

let keyCounter = 0;
let randomBytesCounter = 0;

module.exports = {
  // Key generation
  crypto_box_keypair: jest.fn(() => {
    keyCounter++;
    const seed = `keypair_${keyCounter}`;
    const publicKey = createDeterministicArray(seed + '_pub', PUBLICKEYBYTES);
    const privateKey = createDeterministicArray(seed + '_sec', SECRETKEYBYTES);
    return {
      publicKey,
      privateKey,
    };
  }),

  // Sealed box encryption (public key encryption)
  crypto_box_seal: jest.fn((message, publicKey) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error('Message must be Uint8Array');
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('Public key must be Uint8Array');
    }

    // Create deterministic ciphertext by combining message and public key
    const combined = new Uint8Array(message.length + publicKey.length);
    combined.set(message);
    combined.set(publicKey, message.length);

    const seed = arrayToBase64(combined);
    const ciphertext = createDeterministicArray(seed + '_sealed', message.length + BOXSEALBYTES);
    return ciphertext;
  }),

  // Sealed box decryption
  crypto_box_seal_open: jest.fn((ciphertext, publicKey, privateKey) => {
    if (!(ciphertext instanceof Uint8Array)) {
      throw new Error('Ciphertext must be Uint8Array');
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('Public key must be Uint8Array');
    }
    if (!(privateKey instanceof Uint8Array)) {
      throw new Error('Private key must be Uint8Array');
    }

    // For mock, we reverse the encryption by extracting original message length
    const messageLength = ciphertext.length - BOXSEALBYTES;
    if (messageLength < 0) {
      throw new Error('Ciphertext is too short');
    }

    const message = new Uint8Array(messageLength);
    for (let i = 0; i < messageLength; i++) {
      message[i] = ciphertext[i];
    }
    return message;
  }),

  // Secret box encryption (symmetric key encryption)
  crypto_secretbox_easy: jest.fn((message, nonce, key) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error('Message must be Uint8Array');
    }
    if (!(nonce instanceof Uint8Array)) {
      throw new Error('Nonce must be Uint8Array');
    }
    if (!(key instanceof Uint8Array)) {
      throw new Error('Key must be Uint8Array');
    }

    // Create deterministic ciphertext
    const combined = new Uint8Array(message.length + nonce.length + key.length);
    combined.set(message);
    combined.set(nonce, message.length);
    combined.set(key, message.length + nonce.length);

    const seed = arrayToBase64(combined);
    const ciphertext = createDeterministicArray(seed + '_secretbox', message.length + 16); // 16 bytes for ABYTES
    return ciphertext;
  }),

  // Secret box decryption
  crypto_secretbox_open_easy: jest.fn((ciphertext, nonce, key) => {
    if (!(ciphertext instanceof Uint8Array)) {
      throw new Error('Ciphertext must be Uint8Array');
    }
    if (!(nonce instanceof Uint8Array)) {
      throw new Error('Nonce must be Uint8Array');
    }
    if (!(key instanceof Uint8Array)) {
      throw new Error('Key must be Uint8Array');
    }

    // For mock, extract message (remove 16 bytes of authentication tag)
    const messageLength = ciphertext.length - 16;
    if (messageLength < 0) {
      throw new Error('Ciphertext is too short');
    }

    const message = new Uint8Array(messageLength);
    for (let i = 0; i < messageLength; i++) {
      message[i] = ciphertext[i];
    }
    return message;
  }),

  // Secret box key generation (symmetric key)
  crypto_secretbox_keygen: jest.fn(() => {
    return createDeterministicArray('secretbox_key', 32);
  }),

  // Box encryption (public key encryption)
  crypto_box_easy: jest.fn((message, nonce, publicKey, privateKey) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error('Message must be Uint8Array');
    }
    if (!(nonce instanceof Uint8Array)) {
      throw new Error('Nonce must be Uint8Array');
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('Public key must be Uint8Array');
    }
    if (!(privateKey instanceof Uint8Array)) {
      throw new Error('Private key must be Uint8Array');
    }

    // Create deterministic ciphertext
    const combined = new Uint8Array(message.length + nonce.length + publicKey.length + privateKey.length);
    combined.set(message);
    combined.set(nonce, message.length);
    combined.set(publicKey, message.length + nonce.length);
    combined.set(privateKey, message.length + nonce.length + publicKey.length);

    const seed = arrayToBase64(combined);
    const ciphertext = createDeterministicArray(seed + '_box', message.length + 16); // 16 bytes for ABYTES
    return ciphertext;
  }),

  // Box decryption
  crypto_box_open_easy: jest.fn((ciphertext, nonce, publicKey, privateKey) => {
    if (!(ciphertext instanceof Uint8Array)) {
      throw new Error('Ciphertext must be Uint8Array');
    }
    if (!(nonce instanceof Uint8Array)) {
      throw new Error('Nonce must be Uint8Array');
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('Public key must be Uint8Array');
    }
    if (!(privateKey instanceof Uint8Array)) {
      throw new Error('Private key must be Uint8Array');
    }

    // For mock, extract message (remove 16 bytes of authentication tag)
    const messageLength = ciphertext.length - 16;
    if (messageLength < 0) {
      return null; // Decryption failed
    }

    const message = new Uint8Array(messageLength);
    for (let i = 0; i < messageLength; i++) {
      message[i] = ciphertext[i];
    }
    return message;
  }),

  // Convert Uint8Array to string
  to_string: jest.fn((arr) => {
    if (!(arr instanceof Uint8Array)) {
      throw new Error('Input must be Uint8Array');
    }
    return String.fromCharCode.apply(null, arr);
  }),

  // Random bytes generation
  randombytes_buf: jest.fn((length) => {
    randomBytesCounter++;
    return createDeterministicArray('random_' + randomBytesCounter, length);
  }),

  // Constants
  PUBLICKEYBYTES,
  SECRETKEYBYTES,
  SEEDBYTES,
  NONCEBYTES,
  BOXSEALBYTES,
  ABYTES: 16,
  crypto_secretbox_KEYBYTES: 32,
  crypto_secretbox_NONCEBYTES: 24,
  crypto_box_NONCEBYTES: 24,
  crypto_box_PUBLICKEYBYTES: 32,
  crypto_box_SECRETKEYBYTES: 32,

  // Ready promise
  ready: Promise.resolve(),

  // Reset function for testing
  __reset__: jest.fn(() => {
    keyCounter = 0;
    randomBytesCounter = 0;
  }),
};
