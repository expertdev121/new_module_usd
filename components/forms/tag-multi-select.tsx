"use client";

import { useTagsQuery } from "@/lib/query/tags/useTagsQuery";
import { Tag } from "@/lib/db/schema";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface TagMultiSelectProps {
  field: any; // From react-hook-form
  contactId?: number;
  /**
   * The contact's already-assigned tags (id + name). Used so assigned tags
   * that aren't in the location-scoped /api/tags list (legacy / NULL-location
   * tags) still render a named, removable pill instead of vanishing (GS-9).
   */
  initialTags?: { id: number; name: string }[];
}

export default function TagMultiSelect({ field, contactId, initialTags }: TagMultiSelectProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Load the full tag list (not the API's default page of 10) so every
  // available tag shows in the dropdown.
  const { data: tagsData, isLoading } = useTagsQuery({
    search,
    limit: 1000,
  });

  const availableTags = tagsData?.tags || [];
  const selectedTags = field.value || [];

  // Merge the location-scoped list with the contact's own assigned tags, so an
  // assigned tag that's missing from /api/tags (legacy / NULL-location) still
  // has a name and shows up. Fixes "5 tags selected" rendering only 2 (GS-9).
  const mergedById = new Map<number, { id: number; name: string }>();
  for (const t of availableTags as Tag[]) mergedById.set(t.id, { id: t.id, name: t.name });
  for (const t of initialTags ?? []) if (!mergedById.has(t.id)) mergedById.set(t.id, t);
  const displayTags = Array.from(mergedById.values());
  const nameFor = (id: number) => mergedById.get(id)?.name ?? `Tag #${id}`;

  const handleSelectTag = (tagId: number) => {
    const newTagIds = selectedTags.includes(tagId) 
      ? selectedTags.filter((id: number) => id !== tagId)
      : [...selectedTags, tagId];
    field.onChange(newTagIds);
  };

  const removeTag = (tagId: number) => {
    const newTagIds = selectedTags.filter((id: number) => id !== tagId);
    field.onChange(newTagIds);
  };

  const isTagSelected = (tagId: number) => selectedTags.includes(tagId);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full justify-between h-12"
            disabled={isLoading}
          >
            {selectedTags.length > 0 
              ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''} selected`
              : "Select tags..."
            }
            <Plus className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0 max-h-[300px]">
          <Command>
            <CommandInput 
              placeholder="Search tags..." 
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
{displayTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleSelectTag(tag.id)}
                  >
                    <div className="mr-2 flex items-center">
                      <input
                        type="checkbox"
                        checked={isTagSelected(tag.id)}
                        onChange={() => handleSelectTag(tag.id)}
                        className="mr-2 h-4 w-4 rounded border-gray-300"
                      />
                      <span>{tag.name}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected tags preview */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tagId: number) => (
            <Badge
              key={tagId}
              variant="secondary"
              className="flex items-center gap-1 px-2.5 py-0.5"
            >
              {nameFor(tagId)}
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1 h-4 w-4 p-0 opacity-70 hover:opacity-100"
                onClick={() => removeTag(tagId)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

