-- Allow common mobile image formats in Web Chat without opening the bucket to arbitrary MIME types.
update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[]
where id = 'chat-attachments';
