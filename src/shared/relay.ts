// Relay responses carry metadata only. Payloads, wrapped keys, private keys, and relay tokens stay in the main process.

import type { SecretMetadata } from './secrets'

// off: the relay is turned off. offline: the app waits for the next connection attempt.
export type RelayConnection = 'off' | 'connecting' | 'connected' | 'offline'

// unverified: the users did not compare the pairing code. verified: the saved keys match the relay keys.
// changed: the relay keys differ from the saved keys, so the users must compare the new code. invalid: the keys cannot be used.
export type RelayTrust = 'unverified' | 'verified' | 'changed' | 'invalid'

export interface RelayPeer {
  pairId: string
  identity: string
  name: string
  // The relay status. Only the device that did not send the request can set Verified.
  status: 'Pending' | 'Verified'
  requestedByMe: boolean
  // Both users compare this code before they confirm. It is null when the keys cannot be used.
  code: string | null
  trust: RelayTrust
}

export interface ConfirmRelayPairInput {
  pairId: string
  code: string
}

export interface RelayInboxItem {
  messageId: string
  sender: string
  createdAt: string
  deliverBy: string
  state: 'pending' | 'received' | 'failed'
  projectName: string | null
  secretNames: string[]
  accessExpiresAt: string | null
  injectionOnly: boolean | null
  destinationProjectId: string | null
  receivedAt: string | null
  error: string | null
}

export type RelayDeliveryState = 'queued' | 'sent' | 'received' | 'failed' | 'expired'

export interface RelaySentItem {
  messageId: string
  recipient: string
  state: RelayDeliveryState
  createdAt: string | null
  deliverBy: string | null
  receivedAt: string | null
  error: string | null
}

export interface RelayQueueInput {
  projectId: string
  secretIds: string[]
  recipient: string
  accessExpiresAt: number | null
  injectionOnly: boolean
}

// The main process sets the delivery deadline when it queues the transfer.
export interface RelayTransferInput extends RelayQueueInput {
  deliverBy: number
}

export interface RelayAcceptInput {
  messageId: string
  projectId: string
}

export interface RelayState {
  connection: RelayConnection
  // The relay identity of this device, as a hexadecimal string.
  identity: string | null
  registered: boolean
  error: string | null
  // The time of the last relay update in the cache. Rows are cached when the connection is not connected.
  updatedAt: string | null
  peers: RelayPeer[]
  inbox: RelayInboxItem[]
  sent: RelaySentItem[]
}

export interface RelayAPI {
  getRelayState: () => Promise<RelayState>
  onRelayChanged: (listener: () => void) => () => void
  // The identity is the relay ID of the other device, as 64 hexadecimal characters.
  requestRelayPair: (identity: string) => Promise<void>
  confirmRelayPair: (input: ConfirmRelayPairInput) => Promise<void>
  removeRelayPair: (pairId: string) => Promise<void>
  // Returns the message ID of the queued transfer.
  queueRelayTransfer: (input: RelayQueueInput) => Promise<string>
  acceptRelayTransfer: (input: RelayAcceptInput) => Promise<SecretMetadata[]>
}
