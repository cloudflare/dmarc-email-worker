import * as PostalMime from 'postal-mime'
import * as mimeDb from 'mime-db'

import * as unzipit from 'unzipit'
import * as pako from 'pako'

import { XMLParser } from 'fast-xml-parser'

import { Env, Attachment, DmarcRecordRow } from './types'

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env, ctx)
  },
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  await sendToAnalyticsEngine(env, reportXML)
}

async function getDMARCReportXML(attachment: Attachment) {
  let xml
  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''

  switch (extension) {
    case 'gz':
      xml = pako.inflate(new TextEncoder().encode(attachment.content as string), { to: 'string' })
      break

    case 'zip':
      xml = await getXMLFromZip(attachment.content)
      break

    case 'xml':
      xml = new Response(attachment.content).text()
      break

    default:
      throw new Error(`unknown extension: ${extension}`)
  }

  return await xmlParser.parse(xml)
}

async function getXMLFromZip(content: string | ArrayBuffer | Blob | unzipit.TypedArray | unzipit.Reader) {
  const { entries } = await unzipit.unzipRaw(content)
  if (entries.length === 0) {
    return new Error('no entries in zip')
  }

  return await entries[0].text()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getReportRows(report: any): Promise<DmarcRecordRow[]> {
  const reportMetadata = report.feedback.report_metadata
  const policyPublished = report.feedback.policy_published
  const records = Array.isArray(report.feedback.record) ? report.feedback.record : [report.feedback.record]

  if (!report.feedback || !reportMetadata || !policyPublished || !records) {
    throw new Error('invalid xml')
  }

  const listEvents: DmarcRecordRow[] = []

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

    const reportRow: DmarcRecordRow = {
      reportMetadataReportId: reportMetadata.report_id.toString().replace('-', '_'),
      reportMetadataOrgName: reportMetadata.org_name || '',
      reportMetadataDateRangeBegin: parseInt(reportMetadata.date_range.begin) || 0,
      reportMetadataDateRangeEnd: parseInt(reportMetadata.date_range.end) || 0,
      reportMetadataError: JSON.stringify(reportMetadata.error) || '',

      policyPublishedDomain: policyPublished.domain || '',
      policyPublishedADKIM: policyPublished.adkim || 'r',
      policyPublishedASPF: policyPublished.aspf || 'r',
      policyPublishedP: policyPublished.p || 'none',
      policyPublishedSP: policyPublished.sp || 'none',
      policyPublishedPct: parseInt(policyPublished.pct) || 0,

      recordRowSourceIP: record.row.source_ip || '',

      recordRowCount: parseInt(record.row.count) || 0,
      recordRowPolicyEvaluatedDKIM: record.row.policy_evaluated.dkim || 'fail',
      recordRowPolicyEvaluatedSPF: record.row.policy_evaluated.spf || 'fail',
      recordRowPolicyEvaluatedDisposition: record.row.policy_evaluated.disposition || 'none',

      recordRowPolicyEvaluatedReasonType: record.row.policy_evaluated.reason.type || '',
      recordIdentifiersEnvelopeTo: record.identifiers.envelope_to || '',
      recordIdentifiersHeaderFrom: record.identifiers.header_from || '',
    }

    listEvents.push(reportRow)
  }

  return listEvents
}

async function sendToAnalyticsEngine(env: Env, reportRows: DmarcRecordRow[]) {
  if (!env.DMARC_ANALYTICS) {
    return
  }

  reportRows.forEach((recordRow) => {
    const blobs: string[] = []
    const doubles: number[] = []
    const indexes: string[] = []

    indexes.push(recordRow.reportMetadataOrgName, recordRow.reportMetadataReportId)

    blobs.push(recordRow.reportMetadataReportId)
    blobs.push(recordRow.reportMetadataOrgName)
    doubles.push(recordRow.reportMetadataDateRangeBegin)
    doubles.push(recordRow.reportMetadataDateRangeEnd)
    blobs.push(recordRow.reportMetadataError)

    blobs.push(recordRow.policyPublishedDomain)
    doubles.push(recordRow.policyPublishedADKIM)
    doubles.push(recordRow.policyPublishedASPF)
    doubles.push(recordRow.policyPublishedP)
    doubles.push(recordRow.policyPublishedSP)
    doubles.push(recordRow.policyPublishedPct)

    blobs.push(recordRow.recordRowSourceIP)
    doubles.push(recordRow.recordRowCount)
    doubles.push(recordRow.recordRowPolicyEvaluatedDKIM)
    doubles.push(recordRow.recordRowPolicyEvaluatedSPF)
    doubles.push(recordRow.recordRowPolicyEvaluatedDisposition)
    doubles.push(recordRow.recordRowPolicyEvaluatedReasonType)
    blobs.push(recordRow.recordIdentifiersEnvelopeTo)
    blobs.push(recordRow.recordIdentifiersHeaderFrom)

    env.DMARC_ANALYTICS.writeDataPoint({
      blobs: blobs,
      doubles: doubles,
      indexes: indexes,
    })
  })
}
