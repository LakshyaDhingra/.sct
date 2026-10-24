// Relay responses carry metadata only. Payloads, wrapped keys, private keys, and relay tokens stay in the main process.

// off: the relay is turned off. offline: the app waits for the next connection attempt.
export type RelayConnection = 'off' | 'connecting' | 'connected' | 'offline'

export interface RelayPeer {
  pairId: string
  identity: string
  name: string
  status: 'Pending' | 'Verified'
}

export interface RelayInboxItem {
  messageId: string
  sender: string
  createdAt: string
}

export interface RelaySentItem {
  messageId: string
  recipient: string
  status: 'Pending' | 'Received'
  receivedAt: string | null
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
}
