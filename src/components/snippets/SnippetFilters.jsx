import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
];

const FAVORITE_OPTIONS = [
  { value: 'all', label: 'All snippets' },
  { value: 'favorites', label: 'Favorites' },
];

const SORT_OPTIONS = [
  { value: '-last_copied_at', label: 'Recent copies' },
  { value: '-updated_date', label: 'Recently updated' },
  { value: '-copy_count', label: 'Most copied' },
  { value: 'title', label: 'Title A-Z' },
];

export default function SnippetFilters({
  searchInputId = 'snippet-search-input',
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  favoriteFilter,
  onFavoriteFilterChange,
  sortOrder,
  onSortOrderChange,
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaces = [],
  onReset,
}) {
  return (
    <div className="self-start rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(17rem,1.45fr)_repeat(4,minmax(11rem,1fr))_auto]">
        <Input
          id={searchInputId}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search title, content, tags"
          className="border-white/10 bg-white/[0.04]"
        />

        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger className="border-white/10 bg-white/[0.04]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={favoriteFilter} onValueChange={onFavoriteFilterChange}>
          <SelectTrigger className="border-white/10 bg-white/[0.04]">
            <SelectValue placeholder="Favorites" />
          </SelectTrigger>
          <SelectContent>
            {FAVORITE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={workspaceFilter} onValueChange={onWorkspaceFilterChange}>
          <SelectTrigger className="border-white/10 bg-white/[0.04]">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workspaces</SelectItem>
            <SelectItem value="none">No workspace</SelectItem>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.name || workspace.title || 'Untitled workspace'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortOrder} onValueChange={onSortOrderChange}>
          <SelectTrigger className="border-white/10 bg-white/[0.04]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="button" variant="outline" onClick={onReset} className="border-white/10 bg-transparent sm:col-span-2 xl:col-span-1">
          Reset
        </Button>
      </div>
    </div>
  );
}
