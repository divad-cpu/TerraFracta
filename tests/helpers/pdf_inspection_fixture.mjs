import { createHash } from 'node:crypto';
export const textSha = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const textPage = (page_number, text = 'Manual invented derived text.\n') =>
  ({ page_number, state: 'text_extracted', text, text_sha256: textSha(text), reason_code: null });
// Manual JSON assertions for consumer tests only. These are not actual PDF
// bytes, parser output, source authority or worker-isolation evidence.
export function manualPdfReport() {
  return { schema_version: 1, kind: 'private_pdf_text_inspection', scope: 'native_pdf_page_text_only_unverified',
    document: { source_key: 'fictional-pdf', item_key: 'manual-invented-report', source_version_id: '10000000-0000-4000-8000-000000000001',
      source_url: 'https://example.org/invented.pdf', content_sha256: 'a'.repeat(64), retrieved_at: '2026-10-17T08:00:00.000001Z', media_type: 'application/pdf' },
    observed_at: '2026-10-17T08:00:01.000001Z', original_bytes: 512, parser_identity: 'pypdf/6.21.0:strict:plain',
    limits: { max_input_bytes: 65536, max_pages: 8, max_main_content_bytes: 1048576, max_page_text_bytes: 8192,
      max_total_text_bytes: 65536, max_output_bytes: 131072, wall_seconds: 3, cpu_seconds: 2,
      address_space_bytes: 268435456, core_bytes: 0, file_bytes: 0 }, state: 'inspected', reason_code: null, page_count: 2,
    pages: [textPage(1), { page_number: 2, state: 'no_native_text', text: null, text_sha256: null, reason_code: null }] };
}
