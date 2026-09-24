// Shared filter/sort controls for the Client Requests and per-project Items
// tables. FilterBar is the single entry point both tables render -- it owns
// the bordered toolbar shell and composes search, any number of multi-select
// filters, an optional date range, and sort, so each table just declares its
// own filter config instead of laying out the toolbar by hand.
import { ArrowDownAZ, ArrowUpAZ, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FilterOption = { value: string; label: string };

export function MultiSelectFilter({
  label,
  options,
  groups,
  selected,
  onToggle,
  emptyLabel,
  width = "min-w-[170px]",
}: {
  label: string;
  options?: FilterOption[] | undefined;
  groups?: { label: string; options: FilterOption[] }[] | undefined;
  selected: string[];
  onToggle: (value: string) => void;
  emptyLabel: string;
  width?: string | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={`${width} justify-between font-normal`}>
            {selected.length ? `${selected.length} selected` : emptyLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="max-h-72 overflow-y-auto p-2">
            {groups
              ? groups.map((g) => (
                  <div key={g.label}>
                    <p className="px-2 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase first:pt-0">
                      {g.label}
                    </p>
                    {g.options.map((o) => (
                      <label
                        key={o.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={selected.includes(o.value)}
                          onCheckedChange={() => onToggle(o.value)}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                ))
              : options?.map((o) => (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={selected.includes(o.value)}
                      onCheckedChange={() => onToggle(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export type SortDirection = "asc" | "desc";

export function SortControl<TField extends string>({
  field,
  direction,
  fields,
  onFieldChange,
  onDirectionChange,
}: {
  field: TField;
  direction: SortDirection;
  fields: { value: TField; label: string }[];
  onFieldChange: (field: TField) => void;
  onDirectionChange: (direction: SortDirection) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Sort by</Label>
      <div className="flex gap-1">
        <Select value={field} onValueChange={(v) => onFieldChange(v as TField)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={direction === "asc" ? "Ascending" : "Descending"}
          title={direction === "asc" ? "Ascending" : "Descending"}
          onClick={() => onDirectionChange(direction === "asc" ? "desc" : "asc")}
        >
          {direction === "asc" ? (
            <ArrowUpAZ className="size-4" />
          ) : (
            <ArrowDownAZ className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

export type MultiSelectFilterConfig = {
  key: string;
  label: string;
  emptyLabel: string;
  width?: string | undefined;
  options?: FilterOption[] | undefined;
  groups?: { label: string; options: FilterOption[] }[] | undefined;
  selected: string[];
  onToggle: (value: string) => void;
};

// The single toolbar every stakeholder table renders: search, any number of
// multi-select filters (Status, Project, Request Type, Priority, ...), an
// optional date range, and sort -- all inside one bordered card, so tables
// only need to declare their own filter config rather than lay this out by
// hand. `actions` renders last (e.g. an "Add" button pinned to the right via
// its own `ml-auto`).
export function FilterBar<TSortField extends string>({
  search,
  multiSelects,
  dateRange,
  sort,
  filtersActive,
  onClear,
  actions,
}: {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  multiSelects: MultiSelectFilterConfig[];
  dateRange?: {
    label: string;
    from: string;
    to: string;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
  };
  sort?: {
    field: TSortField;
    direction: SortDirection;
    fields: { value: TSortField; label: string }[];
    onFieldChange: (field: TSortField) => void;
    onDirectionChange: (direction: SortDirection) => void;
  };
  filtersActive: boolean;
  onClear: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-raised">
      {search && (
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label htmlFor="search" className="text-xs text-muted-foreground">
            Search summary
          </Label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className="pl-8"
            />
          </div>
        </div>
      )}

      {multiSelects.map((f) => (
        <MultiSelectFilter
          key={f.key}
          label={f.label}
          options={f.options}
          groups={f.groups}
          selected={f.selected}
          onToggle={f.onToggle}
          emptyLabel={f.emptyLabel}
          width={f.width}
        />
      ))}

      {dateRange && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{dateRange.label} — from</Label>
            <Input
              type="date"
              value={dateRange.from}
              onChange={(e) => dateRange.onFromChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateRange.to}
              onChange={(e) => dateRange.onToChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </>
      )}

      {sort && <SortControl {...sort} />}

      <Button
        variant="ghost"
        onClick={onClear}
        disabled={!filtersActive}
        className="text-muted-foreground"
      >
        <X className="size-4" /> Clear filters
      </Button>

      {actions}
    </div>
  );
}
