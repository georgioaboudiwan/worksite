UPDATE workers SET phone = NULL WHERE phone IS NOT NULL AND trim(phone) = '';
CREATE UNIQUE INDEX workers_owner_phone ON workers(owner_id, phone) WHERE phone IS NOT NULL;
