-- Private bucket for stakeholder item attachments. Not public -- downloads go
-- through short-lived signed URLs generated on click, never a stored public URL.
insert into storage.buckets (id, name, public, file_size_limit)
values ('stakeholder-attachments', 'stakeholder-attachments', false, 20971520) -- 20 MB
on conflict (id) do nothing;

-- Scoped to this bucket only (bucket_id check) -- not a blanket policy across
-- every bucket in the project. Same no-auth tradeoff as the rest of this app:
-- anon can upload/read/delete within this one bucket.
create policy stakeholder_attachments_read
  on storage.objects for select
  using (bucket_id = 'stakeholder-attachments');

create policy stakeholder_attachments_insert
  on storage.objects for insert
  with check (bucket_id = 'stakeholder-attachments');

create policy stakeholder_attachments_delete
  on storage.objects for delete
  using (bucket_id = 'stakeholder-attachments');
