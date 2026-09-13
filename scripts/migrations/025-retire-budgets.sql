-- Apply after the web app no longer references budgets during account deletion.
DROP TABLE IF EXISTS user_budgets;
