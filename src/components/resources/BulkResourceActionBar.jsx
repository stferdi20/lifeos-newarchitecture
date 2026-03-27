import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Tag, Trash2, X, Archive, ArchiveRestore, MapPinned, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function BulkResourceActionBar({
  selectedIds,
  selectedResources,
  filteredCount = 0,
  areas,
  onArchive,
  onUnarchive,
  onAssignArea,
  onAddTag,
  onRemoveTag,
  onDelete,
  onReenrich,
  onReenrichFiltered,
  onClear,
  isWorking = false,
  isReenrichingSelected = false,
  isReenrichingFiltered = false,
  reenrichSelectedLabel = 'Re-enrich',
  reenrichFilteredLabel = '',
}) {
  const [areaId, setAreaId] = useState('__none__');
  const [addTagInput, setAddTagInput] = useState('');
  const [removeTagInput, setRemoveTagInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  useEffect(() => {
    if (!selectedIds.size) {
      setAreaId('__none__');
      setAddTagInput('');
      setRemoveTagInput('');
      setDeleteConfirm('');
    }
  }, [selectedIds]);

  const selectedCount = selectedIds.size;
  const availableTags = useMemo(() => {
    const tagSet = new Set();
    selectedResources.forEach((resource) => (resource.tags || []).forEach((tag) => tagSet.add(tag)));
    return [...tagSet].sort();
  }, [selectedResources]);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl">
      <div className="flex items-center gap-2 pr-1">
        <CheckSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{selectedCount} selected</span>
      </div>

      <Button size="sm" variant="outline" disabled={isWorking} onClick={onArchive} className="border-border text-xs">
        <Archive className="w-3.5 h-3.5 mr-1" /> Archive
      </Button>

      <Button size="sm" variant="outline" disabled={isWorking} onClick={onUnarchive} className="border-border text-xs">
        <ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Unarchive
      </Button>

      <Button size="sm" variant="outline" disabled={isWorking} onClick={onReenrich} className="border-border text-xs">
        {isReenrichingSelected ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
        {isReenrichingSelected ? reenrichSelectedLabel : 'Re-enrich'}
      </Button>

      <Button size="sm" variant="outline" disabled={isWorking || !filteredCount} onClick={onReenrichFiltered} className="border-border text-xs">
        {isReenrichingFiltered ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
        {isReenrichingFiltered ? reenrichFilteredLabel : `Re-enrich ${filteredCount} filtered`}
      </Button>

      <div className="flex items-center gap-2 rounded-xl bg-secondary/30 px-2 py-1.5">
        <MapPinned className="w-3.5 h-3.5 text-muted-foreground" />
        <Select value={areaId} onValueChange={setAreaId} disabled={isWorking}>
          <SelectTrigger className="h-8 w-36 border-border/50 bg-secondary/40 text-xs">
            <SelectValue placeholder="Assign area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Choose area</SelectItem>
            {areas.map((area) => (
              <SelectItem key={area.id} value={area.id}>
                <span className="mr-1">{area.icon}</span> {area.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={isWorking || areaId === '__none__'}
          onClick={() => onAssignArea(areaId)}
          className="text-xs"
        >
          Apply
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-secondary/30 px-2 py-1.5">
        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={addTagInput}
          onChange={(event) => setAddTagInput(event.target.value)}
          placeholder="Add tag"
          className="h-8 w-28 border-border/50 bg-secondary/40 text-xs"
          disabled={isWorking}
        />
        <Button
          size="sm"
          disabled={isWorking || !addTagInput.trim()}
          onClick={() => {
            onAddTag(addTagInput);
            setAddTagInput('');
          }}
          className="text-xs"
        >
          Add
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-secondary/30 px-2 py-1.5">
        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
        <Select value={removeTagInput || '__none__'} onValueChange={(value) => setRemoveTagInput(value === '__none__' ? '' : value)} disabled={isWorking || availableTags.length === 0}>
          <SelectTrigger className="h-8 w-28 border-border/50 bg-secondary/40 text-xs">
            <SelectValue placeholder="Remove tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Remove tag</SelectItem>
            {availableTags.map((tag) => (
              <SelectItem key={tag} value={tag}>#{tag}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={isWorking || !removeTagInput}
          onClick={() => {
            onRemoveTag(removeTagInput);
            setRemoveTagInput('');
          }}
          className="border-border text-xs"
        >
          Remove
        </Button>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" disabled={isWorking} className="text-red-400 hover:bg-red-500/10 hover:text-red-300 text-xs">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected resources?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {selectedCount} resource{selectedCount === 1 ? '' : 's'} and also removes linked project and card references. Type DELETE to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirm}
            onChange={(event) => setDeleteConfirm(event.target.value)}
            placeholder="Type DELETE"
            className="border-border bg-secondary/40"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isWorking || deleteConfirm !== 'DELETE'}
              onClick={(event) => {
                if (deleteConfirm !== 'DELETE') {
                  event.preventDefault();
                  return;
                }
                onDelete();
                setDeleteConfirm('');
              }}
              className="bg-red-600 hover:bg-red-500"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <button onClick={onClear} disabled={isWorking} className="p-1 text-muted-foreground transition-colors hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
