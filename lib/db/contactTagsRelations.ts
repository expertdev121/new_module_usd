import { relations } from "drizzle-orm";
import { contactTags } from "./schema";
import { contact } from "./schema";
import { tag } from "./schema";

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contact, {
    fields: [contactTags.contactId],
    references: [contact.id],
  }),
  tag: one(tag, {
    fields: [contactTags.tagId],
    references: [tag.id],
  }),
}));
