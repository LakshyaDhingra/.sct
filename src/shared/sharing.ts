import type { SecretMetadata } from './secrets'

export interface SharingDevice {
  id: string
  name: string
  fingerprint: string
}

export interface PairingPreview {
  token: string
  device: SharingDevice
  code: string
}

export interface TransferPreview {
  id: string
  sender: SharingDevice
  projectName: string
  secretNames: string[]
  expiresAt: string
}

export interface SharingState {
  device: SharingDevice
  peers: SharingDevice[]
  incoming: TransferPreview[]
}

export interface ShareSecretsInput {
  projectId: string
  secretIds: string[]
  recipientId: string
}

export interface ImportTransferInput {
  transferId: string
  projectId: string
}

export interface SharingAPI {
  getSharingState: () => Promise<SharingState>
  shareDeviceCard: () => Promise<void>
  pickSharingPeer: () => Promise<PairingPreview | null>
  confirmSharingPeer: (token: string) => Promise<SharingDevice>
  shareSecrets: (input: ShareSecretsInput) => Promise<void>
  pickTransfer: () => Promise<TransferPreview | null>
  importTransfer: (input: ImportTransferInput) => Promise<SecretMetadata[]>
  dismissTransfer: (id: string) => Promise<void>
  onSharingChanged: (listener: () => void) => () => void
}
