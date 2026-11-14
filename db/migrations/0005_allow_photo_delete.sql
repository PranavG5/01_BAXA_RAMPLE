-- Owners can always delete a photo (NFR privacy), even one used by an approved
-- storyboard. Deleting it sets that scene's background_asset_id to NULL (the
-- foreign key's ON DELETE SET NULL), which the freeze trigger used to reject,
-- so the whole delete failed. Clearing the photo is now allowed; every other
-- change to an approved scene is still blocked.
create or replace function freeze_approved_scenes() returns trigger language plpgsql as $$
declare st text;
begin
  select state into st from storyboard_versions where id = old.storyboard_version_id;
  if st in ('approved', 'rendering', 'qa', 'complete', 'failed') and (
     new.duration_s is distinct from old.duration_s or
     (new.background_asset_id is distinct from old.background_asset_id and new.background_asset_id is not null) or
     new.treatment is distinct from old.treatment or
     new.motion_prompt is distinct from old.motion_prompt or
     new.model_id is distinct from old.model_id or
     new.voiceover is distinct from old.voiceover or
     new.on_screen_text is distinct from old.on_screen_text) then
    raise exception 'scene % belongs to an approved storyboard version and cannot be edited', old.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;
