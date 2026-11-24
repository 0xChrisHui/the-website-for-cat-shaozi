-- Each deployment environment uses its own business schema.
alter table submissions
  add constraint submissions_source_event_id_key unique (source, event_id),
  drop constraint submissions_event_id_key;
