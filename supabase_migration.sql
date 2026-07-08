-- ═══════════════════════════════════════════════════
-- Müşteri Hizmetleri AI — Yeni Tablolar
-- Supabase SQL Editor'den çalıştırın
-- ═══════════════════════════════════════════════════

-- 1. customer_events — Müşteri etkileşim olayları
CREATE TABLE IF NOT EXISTS customer_events (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  platform TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_created ON customer_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_sender ON customer_events(sender_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON customer_events(event_type);

-- 2. followup_queue — Takip hatırlatma kuyruğu
CREATE TABLE IF NOT EXISTS followup_queue (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_bot_message_at TIMESTAMPTZ NOT NULL,
  reminder_1h_sent BOOLEAN DEFAULT FALSE,
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followup_pending ON followup_queue(is_completed, reminder_1h_sent, reminder_24h_sent);
CREATE INDEX IF NOT EXISTS idx_followup_sender ON followup_queue(sender_id);

-- RLS politikaları (anon key ile insert/select için)
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_queue ENABLE ROW LEVEL SECURITY;

-- Tüm işlemlere izin ver (service key veya anon key)
CREATE POLICY "Allow all on customer_events" ON customer_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on followup_queue" ON followup_queue FOR ALL USING (true) WITH CHECK (true);

-- 3. customer_profiles — CRM Profil ve Etiketleme
CREATE TABLE IF NOT EXISTS customer_profiles (
  sender_id TEXT PRIMARY KEY,
  tags TEXT[] DEFAULT '{}',
  priority TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'Yeni',
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_status ON customer_profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_priority ON customer_profiles(priority);

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on customer_profiles" ON customer_profiles FOR ALL USING (true) WITH CHECK (true);

-- 4. orders — Ciro takibi için siparişler tablosu
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'TRY',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);
