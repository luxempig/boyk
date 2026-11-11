-- Anonymous barcode scan counters: which barcodes people scan and how far the
-- lookup got (company / brand / product / none). No user, IP or device is
-- stored, only the barcode and counts. Used to aim coverage work at products
-- people actually buy and to track the share of scans that reach a company.

CREATE TABLE IF NOT EXISTS public.barcode_scan_stats (
    barcode    text PRIMARY KEY,
    outcome    text NOT NULL,
    scans      integer NOT NULL DEFAULT 1,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.barcode_scan_daily (
    day     date NOT NULL,
    outcome text NOT NULL,
    scans   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, outcome)
);

CREATE INDEX IF NOT EXISTS barcode_scan_stats_outcome_scans_idx
    ON public.barcode_scan_stats (outcome, scans DESC);

ALTER TABLE public.barcode_scan_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_scan_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.barcode_scan_stats, public.barcode_scan_daily FROM anon, authenticated;

-- Called by the Cloudflare worker after each lookup. Anyone holding the anon
-- key can call it, so it only accepts well-formed GTINs (valid check digit)
-- and the four known outcomes; the worst abuse is inflating a counter.
CREATE OR REPLACE FUNCTION public.record_barcode_scan(p_barcode text, p_outcome text)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_code  text := ltrim(p_barcode, '0');
    v_sum   int := 0;
    v_digit int;
    i       int;
BEGIN
    IF p_outcome NOT IN ('company', 'brand', 'product', 'none') THEN
        RETURN;
    END IF;
    IF p_barcode IS NULL OR p_barcode !~ '^[0-9]{8,14}$' THEN
        RETURN;
    END IF;
    -- GTIN check digit: weights 3,1,3,1… from the digit left of the check digit.
    FOR i IN 1 .. length(p_barcode) - 1 LOOP
        v_digit := substr(p_barcode, length(p_barcode) - i, 1)::int;
        v_sum := v_sum + v_digit * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END;
    END LOOP;
    IF (10 - v_sum % 10) % 10 <> right(p_barcode, 1)::int THEN
        RETURN;
    END IF;

    -- Store without leading zeros so EAN-13 and UPC-A spellings of one product meet.
    INSERT INTO barcode_scan_stats AS s (barcode, outcome)
    VALUES (v_code, p_outcome)
    ON CONFLICT (barcode) DO UPDATE
        SET scans = s.scans + 1, outcome = EXCLUDED.outcome, last_seen = now();

    INSERT INTO barcode_scan_daily AS d (day, outcome, scans)
    VALUES ((now() AT TIME ZONE 'UTC')::date, p_outcome, 1)
    ON CONFLICT (day, outcome) DO UPDATE SET scans = d.scans + 1;
END $$;

REVOKE ALL ON FUNCTION public.record_barcode_scan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_barcode_scan(text, text) TO anon, authenticated, service_role;
