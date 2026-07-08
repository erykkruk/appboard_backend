CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_chat_messages_app_id_index" ON "ai_chat_messages" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "ai_chat_messages_workspace_id_index" ON "ai_chat_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "app_group_members_app_id_index" ON "app_group_members" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "apps_store_id_index" ON "apps" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "assets_app_id_index" ON "assets" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "in_app_purchases_group_id_index" ON "in_app_purchases" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "listing_history_app_id_index" ON "listing_history" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "reviews_app_id_index" ON "reviews" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stores_workspace_id_index" ON "stores" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "version_localizations_app_id_index" ON "version_localizations" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "workspace_members" USING btree ("user_id");