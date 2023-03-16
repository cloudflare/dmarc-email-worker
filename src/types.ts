export interface Env {
  R2_BUCKET: R2Bucket
}

export type Header = Record<string, string>

export type Address = {
  address: string
  name: string
}

export type Attachment = {
  filename: string
  mimeType: string
  disposition: 'attachment' | 'inline' | null
  related?: boolean
  contentId?: string
  content: string
}

export type Email = {
  headers: Header[]
  from: Address
  sender?: Address
  replyTo?: Address[]
  deliveredTo?: string
  returnPath?: string
  to: Address[]
  cc?: Address[]
  bcc?: Address[]
  subject?: string
  messageId: string
  inReplyTo?: string
  references?: string
  date?: string
  html?: string
  text?: string
  attachments: Attachment[]
}
