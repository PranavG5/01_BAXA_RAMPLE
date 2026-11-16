-- Any kind of business can use Rample: business_type is now free text the
-- owner types (e.g. "Bakery", "Yoga studio"), not just barbershop or salon.
alter table business_profiles drop constraint if exists business_profiles_business_type_check;
alter table business_profiles alter column business_type set default '';
