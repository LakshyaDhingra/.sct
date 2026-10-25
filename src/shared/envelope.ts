// Relay envelopes travel as JSON bytes. The relay stores them without reading them.
// Only the main process creates and opens envelopes. The renderer never receives secret values.

export interface RelayGrant {
  // Milliseconds since the Unix epoch. Null means that access does not expire.
  accessExpiresAt: number | null
  // The recipient can use the secrets in commands but cannot share them again.
  injectionOnly: boolean
}

export interface RelayTransferContents {
  projectName: string
  secrets: { name: string; value: string }[]
  grant: RelayGrant
}

export interface RelayReceiptContents {
  status: 'received'
  receivedAt: number
  secretCount: number
}

export interface RelayExpiryContents {
  status: 'expired'
  expiredAt: number
  secretCount: number
}

// Relay identities and device IDs are 64 hexadecimal characters. Keys, IVs, tags, ciphertext, and signatures are base64.
export interface RelayTransfer {
  format: 'sct-relay'
  version: 1
  kind: 'transfer'
  // The relay message ID. Retries reuse it.
  id: string
  sender: string
  senderDevice: string
  recipients: string[]
  createdAt: number
  deliverBy: number
  ephemeralKey: string
  iv: string
  tag: string
  ciphertext: string
  signature: string
}

// The message key of one transfer, encrypted for one recipient.
export interface RelayWrappedKey {
  iv: string
  tag: string
  key: string
}

export interface RelayReceipt {
  format: 'sct-relay'
  version: 1
  kind: 'receipt'
  // The ID of the transfer that this receipt confirms.
  correlationId: string
  sender: string
  senderDevice: string
  recipient: string
  createdAt: number
  ephemeralKey: string
  iv: string
  tag: string
  ciphertext: string
  signature: string
}

export interface RelayExpiryNotice {
  format: 'sct-relay'
  version: 1
  kind: 'expiry'
  // The ID of the transfer whose local grant expired.
  correlationId: string
  sender: string
  senderDevice: string
  recipient: string
  createdAt: number
  ephemeralKey: string
  iv: string
  tag: string
  ciphertext: string
  signature: string
}
