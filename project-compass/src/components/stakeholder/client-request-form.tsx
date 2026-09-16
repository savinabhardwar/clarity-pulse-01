import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCreateClientRequest, useProjects } from "@/data/queries";
import {
  getIdentity,
  kindForRequestType,
  PRIORITIES,
  REQUEST_TYPES,
  STAKEHOLDER_STATUSES,
  type ItemDraft,
  type Priority,
  type RequestType,
} from "@/lib/stakeholder-types";

const formSchema = z.object({
  projectIds: z.array(z.string()).min(1, "Select at least one project."),
  requestType: z.enum(["product_enhancement", "product_bug", "new_request", "client_onboarding"], {
    required_error: "Request type is required.",
  }),
  summary: z.string().trim().min(1, "Summary is required."),
  description: z.string(),
  priority: z.enum(["High", "Medium", "Low"]),
  requiredBy: z.string().nullable(),
  willBeDoneBy: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

function emptyValues(): FormValues {
  return {
    projectIds: [],
    requestType: undefined as unknown as RequestType,
    summary: "",
    description: "",
    priority: "Medium",
    requiredBy: "",
    willBeDoneBy: "",
  };
}

export function ClientRequestFormDrawer({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { data: projects } = useProjects();
  const createClientRequest = useCreateClientRequest();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (open) form.reset(emptyValues());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSubmit(values: FormValues) {
    const draft: ItemDraft = {
      requestType: values.requestType,
      summary: values.summary.trim(),
      description: values.description,
      // Fixed default -- this form never exposes a status/status-kind
      // picker, unlike item-form.tsx. Items created here always start in
      // the first stakeholder status.
      status: STAKEHOLDER_STATUSES[0],
      statusKind: "stakeholder",
      priority: values.priority,
      createdBy: getIdentity()?.name ?? "Unknown",
      requiredBy: values.requiredBy || null,
      willBeDoneBy: values.willBeDoneBy || null,
    };

    createClientRequest.mutate(
      { projectIds: values.projectIds, kind: kindForRequestType(values.requestType), draft },
      {
        onSuccess: () => {
          onSaved();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Add Client Request</SheetTitle>
          <SheetDescription>
            Create a new request for a project. It will appear in that project's module as well as
            here.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="projectIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full justify-between font-normal"
                            >
                              {field.value.length
                                ? `${field.value.length} selected`
                                : "Select project(s)"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-0" align="start">
                          <div className="max-h-72 overflow-y-auto p-2">
                            {(projects ?? []).map((p) => (
                              <label
                                key={p.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                              >
                                <Checkbox
                                  checked={field.value.includes(p.id)}
                                  onCheckedChange={(checked) => {
                                    field.onChange(
                                      checked
                                        ? [...field.value, p.id]
                                        : field.value.filter((id) => id !== p.id),
                                    );
                                  }}
                                />
                                {p.code} · {p.name}
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <p className="text-xs text-muted-foreground">
                        Select one project to route this request directly, or multiple if the
                        destination is still undecided — it&apos;ll wait in Client Requests as a
                        decision until someone picks one.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requestType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Request Type *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as RequestType)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select request type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REQUEST_TYPES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Summary *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Short, outcome-oriented title"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="What is being asked for, and why"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as Priority)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Created By</Label>
                  <p className="text-sm">{getIdentity()?.name ?? "Unknown"}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="requiredBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required By Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="willBeDoneBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Will Be Done By Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createClientRequest.isPending}>
                {createClientRequest.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
