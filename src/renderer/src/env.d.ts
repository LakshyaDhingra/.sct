import type { SctAPI } from '../../shared/projects'

declare global {
  interface Window {
    sct: SctAPI
  }
}
