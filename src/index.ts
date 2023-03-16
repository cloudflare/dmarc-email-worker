/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import * as PostalMime from 'postal-mime'
import * as mimeDb from 'mime-db'

import * as unzipit from 'unzipit'
import * as pako from 'pako'

import { XMLParser } from 'fast-xml-parser'

import { Env, Attachment } from './types'

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env, ctx)
  },
}

async function handleEmail(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const parser = new PostalMime.default()

  // parse email content
  const rawEmail = new Response(message.raw)
  const email = await parser.parse(rawEmail.arrayBuffer())

  // get attachment
  if (email.attachments === null || email.attachments.length === 0) {
    throw new Error('no attachments')
  }
  const attachment = email.attachments[0]

  // save on R2
  if (env.R2_BUCKET) {
    const date = new Date()
    await env.R2_BUCKET.put(
      `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${attachment.filename}`,
      attachment.content
    )
  }

  const reportXML = await getDMARCReportXML(attachment)

  // parse the dmarc-report
  const xmlParser = new XMLParser()
  const report = await xmlParser.parse(reportXML)

  console.log(report)
}

async function getDMARCReportXML(attachment: Attachment) {
  let xml
  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''
  try {
    switch (extension) {
      case 'gz':
        xml = await getXMLFromGz(attachment.content)
        break

      case 'zip':
        xml = await getXMLFromZip(attachment.content)
        break

      case 'xml':
        xml = await new Response(attachment.content).text()
        break

      default:
        return
    }
  } catch (error) {
    return error
  }

  if (!xml) {
    return new Error('empty xml')
  }

  return await xmlParser.parse(xml)
}

async function getXMLFromGz(content: any) {
  try {
    return await pako.inflate(content, { to: 'string' })
  } catch (error) {
    return error
  }
}

async function getXMLFromZip(content: string | ArrayBuffer | Blob | unzipit.TypedArray | unzipit.Reader) {
  try {
    const { entries } = await unzipit.unzipRaw(content)
    if (entries.length === 0) {
      return new Error('no entries')
    }

    return await entries[0].text()
  } catch (error) {
    return error
  }
}
