import * as PostalMime from 'postal-mime'
import * as mimeDb from 'mime-db'

import { decompressSync, unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

import {
  Env,
  Attachment,
  DmarcRecordRow,
  AlignmentType,
  DispositionType,
  DMARCResultType,
  PolicyOverrideType,
} from './types'

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env, ctx)
  },
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const parser = new PostalMime.default()

  // parse email content
  const rawEmail = new Response(message.raw)

  const email = await parser.parse(await rawEmail.arrayBuffer())

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

  // get xml
  const reportJSON = await getDMARCReportXML(attachment)

  // get report
  const report = getReportRows(reportJSON)

  // send to analytics engine
  await sendToAnalyticsEngine(env, report)
}

async function getDMARCReportXML(attachment: Attachment) {
  let xml

  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''

  if (extension === 'gz') {
    const attachmentDecompressed = decompressSync(new Uint8Array(attachment.content))
    xml = strFromU8(attachmentDecompressed)
  }

  if (extension === 'zip') {
    const attachmentsUnzipped = Object.values(unzipSync(new Uint8Array(attachment.content)))

    if (attachmentsUnzipped.length === 0) {
      throw new Error('Empty zip archive')
    }

    xml = strFromU8(attachmentsUnzipped[0])
  }

  if (extension === 'xml') {
    xml = await new Response(attachment.content).text()
  }

  if (!xml) {
    throw new Error(`Invalid attachment or unknown extension: ${extension}`)
  }

  return await xmlParser.parse(xml)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReportRows(report: any): DmarcRecordRow[] {
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
      policyPublishedADKIM: AlignmentType[policyPublished.adkim as keyof typeof AlignmentType],
      policyPublishedASPF: AlignmentType[policyPublished.aspf as keyof typeof AlignmentType],
      policyPublishedP: DispositionType[policyPublished.p as keyof typeof DispositionType],
      policyPublishedSP: DispositionType[policyPublished.sp as keyof typeof DispositionType],
      policyPublishedPct: parseInt(policyPublished.pct) || 0,

      recordRowSourceIP: record.row.source_ip || '',

      recordRowCount: parseInt(record.row.count) || 0,
      recordRowPolicyEvaluatedDKIM: DMARCResultType[record.row.policy_evaluated.dkim as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedSPF: DMARCResultType[record.row.policy_evaluated.spf as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedDisposition:
        DispositionType[record.row.policy_evaluated.disposition as keyof typeof DispositionType],

      recordRowPolicyEvaluatedReasonType:
        PolicyOverrideType[record.row.policy_evaluated?.reason?.type as keyof typeof PolicyOverrideType],
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

  reportRows.forEach((recordRow, index) => {
    const blobs: string[] = []
    const doubles: number[] = []
    const indexes: string[] = []

    indexes.push(encodeURI(`${recordRow.reportMetadataReportId}-${index}`).slice(0, 32)) // max size 32 bytes

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
