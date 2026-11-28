import { useState } from "react"
import { data, useFetcher, useLoaderData } from "react-router"
import type { Route } from "./+types/forms.$formId.dropped"
import { formatDistanceToNow } from "date-fns"
import { Inbox, Loader2, Trash2 } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip"
import { requireAuth } from "~/lib/require-auth.server"
import { FIELD_LABELS } from "~/lib/field-labels"

export const meta: Route.MetaFunction = () => {
  return [
    { title: `Held for review | FormZero` },
    { name: "description", content: "Review submissions the spam filter held back" },
  ];
};

type DroppedRow = {
  id: string
  form_id: string
  data: Record<string, unknown>
  reason: string
  created_at: number
}

// Plain-words labels for the heuristic reasons stored in `dropped_submissions.reason`.
// These are suspicions, not verdicts, so the wording describes what tripped the
// filter rather than calling anything spam.
const REASON_LABELS: Record<string, string> = {
  url_in_name: "Name contained a link",
  disposable_email_domain: "Email domain looked disposable",
  token_only_message: "Message was a single short token",
  too_many_urls: "Message contained several links",
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { formId } = params
  const database = context.cloudflare.env.DB

  await requireAuth(request, database)

  const rows = await database
    .prepare(
      "SELECT id, form_id, data, reason, created_at FROM dropped_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT 200"
    )
    .bind(formId)
    .all()

  // Parse the JSON data field for each row. A malformed row shouldn't take the
  // whole page down; it renders with no fields instead.
  const dropped: DroppedRow[] = rows.results.map((row: any) => {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(row.data)
    } catch {
      // leave parsed as an empty object
    }
    return {
      id: row.id,
      form_id: row.form_id,
      data: parsed,
      reason: row.reason,
      created_at: row.created_at,
    }
  })

  return { dropped }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const database = context.cloudflare.env.DB

  await requireAuth(request, database)

  if (request.method !== "DELETE") {
    return data(
      { success: false, error: "Method not allowed" },
      { status: 405 }
    )
  }

  const formData = await request.formData()
  const id = formData.get("id")

  if (typeof id !== "string" || id === "") {
    return data(
      { success: false, error: "Missing id" },
      { status: 400 }
    )
  }

  try {
    const result = await database
      .prepare("DELETE FROM dropped_submissions WHERE id = ? AND form_id = ?")
      .bind(id, params.formId)
      .run()

    if (result.meta.changes === 0) {
      return data(
        { success: false, error: "Submission not found" },
        { status: 404 }
      )
    }

    return data({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Error deleting dropped submission:", error)
    return data(
      { success: false, error: "Failed to delete submission" },
      { status: 500 }
    )
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ")
  if (value === undefined || value === null) return ""
  return String(value)
}

function fieldLabel(key: string): string {
  return FIELD_LABELS.get(key) ?? (key.charAt(0).toUpperCase() + key.slice(1))
}

// name and email first, message last so it gets the full width, everything
// else in between.
function fieldOrder(key: string): number {
  if (key === "name") return 0
  if (key === "email") return 1
  if (key === "message") return 3
  return 2
}

function DeleteDroppedButton({ row }: { row: DroppedRow }) {
  const fetcher = useFetcher()
  const [open, setOpen] = useState(false)
  const isDeleting = fetcher.state !== "idle"

  const handleDelete = () => {
    fetcher.submit({ id: row.id }, { method: "delete" })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label="Delete held submission"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !isDeleting && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this submission?</DialogTitle>
            <DialogDescription>
              This removes the only copy. It was never delivered or emailed, so
              if it was a real enquiry it cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DroppedRowCard({ row }: { row: DroppedRow }) {
  const date = new Date(row.created_at)
  const relativeTime = formatDistanceToNow(date, { addSuffix: true })
  const exactTime = date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  })
  const reasonLabel = REASON_LABELS[row.reason] ?? "Flagged for review"

  const fieldKeys = Object.keys(row.data).sort((a, b) => {
    const order = fieldOrder(a) - fieldOrder(b)
    return order !== 0 ? order : a.localeCompare(b)
  })
  const shortKeys = fieldKeys.filter((key) => key !== "message")
  const messageValue = formatValue(row.data["message"])

  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <TooltipProvider delayDuration={1000}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>{relativeTime}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{exactTime}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span aria-hidden="true">·</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {reasonLabel}
              </span>
            </div>
            <DeleteDroppedButton row={row} />
          </div>

          {fieldKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No readable fields in this row.
            </p>
          ) : (
            <>
              {shortKeys.length > 0 && (
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {shortKeys.map((key) => (
                    <div key={key} className="flex min-w-0 gap-2 text-sm">
                      <span className="shrink-0 text-muted-foreground">
                        {fieldLabel(key)}
                      </span>
                      <span className="break-words font-medium">
                        {formatValue(row.data[key])}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {messageValue !== "" && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{fieldLabel("message")}</span>
                  <p className="whitespace-pre-wrap break-words">{messageValue}</p>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DroppedPage() {
  const { dropped } = useLoaderData<typeof loader>()

  return (
    <div className="flex flex-1 flex-col gap-2 min-w-0">
      {dropped.length === 0 ? (
        <div className="flex flex-1 items-center justify-center min-w-0 py-12">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox className="h-10 w-10" />
              </EmptyMedia>
              <EmptyTitle>Nothing held back</EmptyTitle>
              <EmptyDescription>
                When the spam filter flags a submission, it is held back here
                instead of being delivered or emailed, so you can look it over.
                Nothing is currently being held back for this form.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground max-w-2xl">
            These submissions were held back by the spam filter instead of being
            delivered or emailed. The filter isn't perfect, so some of these may
            be real enquiries. Have a look before deleting anything.
          </p>
          <div className="flex flex-col gap-2">
            {dropped.map((row) => (
              <DroppedRowCard key={row.id} row={row} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
