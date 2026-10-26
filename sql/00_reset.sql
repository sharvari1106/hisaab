-- =====================================================================
-- Hisaab : 00_reset.sql
-- Drops every object so the schema can be rebuilt from scratch.
-- (Demonstrates DROP ... CASCADE / IF EXISTS)
-- =====================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_monthly_sales CASCADE;
DROP VIEW IF EXISTS v_reorder_suggestions, v_customer_monthly_trend, v_customer_risk,
                    v_expiring_soon, v_product_stock, v_daily_sales CASCADE;

DROP TABLE IF EXISTS alerts, stock_movements, ledger_entries, payments,
                     invoice_items, invoices, batches, purchases, suppliers,
                     product_aliases, products, categories, users, customers, shops CASCADE;

DROP FUNCTION IF EXISTS fn_process_sale, fn_hybrid_search, fn_similar_products,
                        fn_prefix_tsquery, fn_build_search_doc, trg_products_search_doc,
                        trg_aliases_search_doc, trg_ledger_apply, trg_ledger_immutable,
                        trg_batches_stock_alert, trg_batches_purchase_total CASCADE;
DROP PROCEDURE IF EXISTS sp_record_payment, sp_write_off_expired, sp_refresh_reports CASCADE;

DROP TYPE IF EXISTS user_role, pay_mode, ledger_kind, movement_reason CASCADE;
