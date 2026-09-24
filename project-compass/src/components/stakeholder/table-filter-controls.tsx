// Shared filter/sort controls for the Client Requests and per-project Items
// tables. FilterBar is the single entry point both tables render -- it owns
// the bordered toolbar shell and composes search, one Jira-style Filter
// panel (FilterPanel, covering Status/Project/Request Type/Priority/... as
// categories in a single popover rather than one dropdown button per
// filter), an optional date range, and sort, so each table just declares
// its own filter config instead of laying out the toolbar by hand.
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarRange,
  ChevronDown,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";

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
import { cn } from "@/lib/utils";

type FilterOption = { value: string; label: string };

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

function categoryOptionCount(c: MultiSelectFilterConfig): number {
  return c.groups ? c.groups.reduce((n, g) => n + g.options.length, 0) : (c.options?.length ?? 0);
}

// A single Jira-style "Filter" button: one popover with a left-hand list of
// filter categories (Status, Project, Request Type, Priority, ...) and a
// right-hand searchable checkbox list for whichever category is selected --
// instead of one separate dropdown button per filter.
function FilterPanel({ categories }: { categories: MultiSelectFilterConfig[] }) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key);
  const [query, setQuery] = useState("");

  const active = categories.find((c) => c.key === activeKey) ?? categories[0];
  const totalSelected = categories.reduce((sum, c) => sum + c.selected.length, 0);

  const q = query.trim().toLowerCase();

  if (!active) return null;

  function selectCategory(key: string) {
    setActiveKey(key);
    setQuery("");
  }

  function clearActive() {
    if (!active) return;
    for (const v of [...active.selected]) active.onToggle(v);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Filter</Label>
      <Popover onOpenChange={(open) => open && setQuery("")}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-1.5 font-normal">
            <ListFilter className="size-4" />
            Filter
            {totalSelected > 0 && (
              <span className="rounded-full bg-brand-soft px-1.5 text-xs font-semibold text-brand">
                {totalSelected}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[520px] p-0" align="start">
          <div className="flex h-80">
            <div className="w-40 shrink-0 space-y-0.5 overflow-y-auto border-r border-border p-2">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => selectCategory(c.key)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    c.key === active.key
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                  {c.selected.length > 0 && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {c.selected.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-1 flex-col">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${active.label.toLowerCase()}`}
                    className="h-8 pl-7 text-sm"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {active.groups
                  ? active.groups.map((g) => {
                      const matches = g.options.filter((o) => o.label.toLowerCase().includes(q));
                      if (matches.length === 0) return null;
                      return (
                        <div key={g.label}>
                          <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase first:pt-0">
                            {g.label}
                          </p>
                          {matches.map((o) => (
                            <label
                              key={o.value}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                            >
                              <Checkbox
                                checked={active.selected.includes(o.value)}
                                onCheckedChange={() => active.onToggle(o.value)}
                              />
                              {o.label}
                            </label>
                          ))}
                        </div>
                      );
                    })
                  : (active.options ?? [])
                      .filter((o) => o.label.toLowerCase().includes(q))
                      .map((o) => (
                        <label
                          key={o.value}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={active.selected.includes(o.value)}
                            onCheckedChange={() => active.onToggle(o.value)}
                          />
                          {o.label}
                        </label>
                      ))}
              </div>

              <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {active.selected.length} of {categoryOptionCount(active)} selected
                </span>
                <button
                  type="button"
                  onClick={clearActive}
                  disabled={active.selected.length === 0}
                  className="font-medium hover:text-foreground disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export type DateRangeFilterConfig<TDateField extends string> = {
  fields: { value: TDateField; label: string }[];
  field: TDateField | null;
  from: string;
  to: string;
  onFieldChange: (field: TDateField) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
};

// A single "Date Range" button/popover: first choose which date field to
// filter by (e.g. Required By vs. Will Be Done By), then set a from/to range
// for that field -- instead of two bare, always-visible date inputs.
function DateRangeFilter<TDateField extends string>({
  fields,
  field,
  from,
  to,
  onFieldChange,
  onFromChange,
  onToChange,
}: DateRangeFilterConfig<TDateField>) {
  const [open, setOpen] = useState(false);
  const activeFieldLabel = fields.find((f) => f.value === field)?.label;
  const hasRange = !!from || !!to;

  function clearRange() {
    onFromChange("");
    onToChange("");
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Date Range</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-1.5 font-normal">
            <CalendarRange className="size-4" />
            {activeFieldLabel ? (
              <span className="flex items-center gap-1.5">
                {activeFieldLabel}
                {hasRange && (
                  <span className="rounded-full bg-brand-soft px-1.5 text-xs font-semibold text-brand">
                    {from || "…"} – {to || "…"}
                  </span>
                )}
              </span>
            ) : (
              "Date Range"
            )}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="space-y-1.5 p-3">
            <Label className="text-xs text-muted-foreground">Filter by</Label>
            <Select
              {...(field ? { value: field } : {})}
              onValueChange={(v) => onFieldChange(v as TDateField)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a date field" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {field && (
            <>
              <p className="border-t border-border px-3 pt-3 pb-2 text-sm font-semibold">
                Filter by Date
              </p>
              <div className="flex gap-2 px-3 pb-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <div className="relative">
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => onFromChange(e.target.value)}
                      placeholder="Select start date"
                      className="w-full pr-8"
                    />
                    <CalendarRange className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <div className="relative">
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => onToChange(e.target.value)}
                      placeholder="Select end date"
                      className="w-full pr-8"
                    />
                    <CalendarRange className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearRange}
                  disabled={!hasRange}
                  className="text-muted-foreground"
                >
                  Clear
                </Button>
                <Button type="button" size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// The single toolbar every stakeholder table renders: search, any number of
// multi-select filters (Status, Project, Request Type, Priority, ...), an
// optional date range, and sort -- all inside one bordered card, so tables
// only need to declare their own filter config rather than lay this out by
// hand. `actions` renders last (e.g. an "Add" button pinned to the right via
// its own `ml-auto`).
export function FilterBar<TSortField extends string, TDateField extends string = string>({
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
  dateRange?: DateRangeFilterConfig<TDateField>;
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

      {multiSelects.length > 0 && <FilterPanel categories={multiSelects} />}

      {dateRange && <DateRangeFilter {...dateRange} />}

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
