import { useState, useEffect, useRef } from "react"
import { useFetcher } from "react-router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { cn } from "#/lib/utils"
import { ResultButton } from "#/components/result-button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip"
import { Mail, Lock, Server, User } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog"
import type { MailTransport, Settings } from "#/types/settings"

// Fields the current sending method does not use stay on screen so the card
// keeps its shape, but they read as locked rather than merely dimmed.
const LOCKED_FIELD =
  "disabled:border-dashed disabled:border-muted-foreground/40 disabled:bg-muted-foreground/10 disabled:text-muted-foreground disabled:opacity-60"

// Once the caret is in the field the watermark has said its part, and leaving
// it there only competes with what is being typed.
const CLEAR_PLACEHOLDER = "focus:placeholder:text-transparent"

// SMTP configurations for common email providers
const SMTP_CONFIGS: Record<string, { host: string; port: number; hint: string }> = {
  "gmail.com": {
    host: "smtp.gmail.com",
    port: 587,
    hint: "For Gmail, use an App Password instead of your regular password. Go to Google Account → Security → 2-Step Verification → App passwords."
  },
  "outlook.com": {
    host: "smtp-mail.outlook.com",
    port: 587,
    hint: "For Outlook, use your regular Microsoft account password or an App Password if you have 2FA enabled."
  },
  "hotmail.com": {
    host: "smtp-mail.outlook.com",
    port: 587,
    hint: "For Hotmail, use your regular Microsoft account password or an App Password if you have 2FA enabled."
  },
  "yahoo.com": {
    host: "smtp.mail.yahoo.com",
    port: 587,
    hint: "For Yahoo, generate an App Password at: Account Info → Account Security → Generate app password."
  },
  "icloud.com": {
    host: "smtp.mail.me.com",
    port: 587,
    hint: "For iCloud, use an App-Specific Password. Go to appleid.apple.com → Sign-In and Security → App-Specific Passwords."
  },
}

function getEmailDomain(email: string): string | null {
  const match = email.match(/@(.+)$/)
  return match ? match[1].toLowerCase() : null
}

type Draft = {
  email: string
  password: string
  username: string
  host: string
  port: string
}

const BLANK_DRAFT: Draft = {
  email: "",
  password: "",
  username: "",
  host: "",
  port: "",
}

// The stored row belongs to the method it was saved under. Its SMTP columns
// only mean something to SMTP, so the address is all Cloudflare takes over.
function storedDraft(settings: Settings | null, savedAs: MailTransport): Draft {
  const smtp = savedAs === "smtp" ? settings : null
  return {
    email: settings?.notification_email || "",
    password: smtp?.notification_email_password || "",
    username: smtp?.smtp_username || "",
    host: smtp?.smtp_host || "",
    port: smtp?.smtp_port?.toString() || "",
  }
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings | null
  /** The stored sending method, or the deployment default before anything is stored. */
  transport: MailTransport
  /** True when this Worker carries the Cloudflare send binding. */
  cloudflareAvailable: boolean
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  transport,
  cloudflareAvailable,
}: SettingsDialogProps) {
  const fetcher = useFetcher()
  const testFetcher = useFetcher()
  const clearFetcher = useFetcher()

  // Only the stored method has a config to show; the other one starts blank.
  const draftFor = (method: MailTransport): Draft =>
    method === transport ? storedDraft(settings, transport) : BLANK_DRAFT

  const [initialDraft] = useState(() => draftFor(transport))
  const [email, setEmail] = useState(initialDraft.email)
  const [password, setPassword] = useState(initialDraft.password)
  const [smtpHost, setSmtpHost] = useState(initialDraft.host)
  const [smtpPort, setSmtpPort] = useState(initialDraft.port)
  const [smtpUsername, setSmtpUsername] = useState(initialDraft.username)
  const [selectedTransport, setSelectedTransport] =
    useState<MailTransport>(transport)

  const providerFor = (address: string) =>
    SMTP_CONFIGS[getEmailDomain(address) ?? ""] ?? null

  const [smtpConfig, setSmtpConfig] = useState<typeof SMTP_CONFIGS[string] | null>(
    () => providerFor(initialDraft.email)
  )

  const applyDraft = (draft: Draft) => {
    setEmail(draft.email)
    setPassword(draft.password)
    setSmtpUsername(draft.username)
    setSmtpHost(draft.host)
    setSmtpPort(draft.port)
    // The provider lookup below is debounced, and the lock should not wait.
    setSmtpConfig(providerFor(draft.email))
  }

  // Cloudflare needs no SMTP socket at all, and a recognised provider fills
  // the socket fields in, so both cases keep them on screen but locked.
  const smtpLocked = selectedTransport === "cloudflare"
  const hostLocked = smtpLocked || Boolean(smtpConfig)
  // The labels of the fields the operator cannot edit dim along with them.
  const lockedLabel = hostLocked ? "text-muted-foreground" : undefined
  const [testPassed, setTestPassed] = useState(false)
  const [testResultValid, setTestResultValid] = useState(true)

  // Adopt the stored values only when the row itself changed. Every action on
  // the page revalidates the settings loader and hands down a new object for
  // the same row, which would otherwise wipe an address that was just typed
  // and verified. Closing the dialog forgets that, so the next visit starts
  // from what is stored.
  const appliedUpdatedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      appliedUpdatedAt.current = null
      return
    }
    if (!settings || appliedUpdatedAt.current === settings.updated_at) return

    appliedUpdatedAt.current = settings.updated_at
    setSelectedTransport(transport)
    applyDraft(storedDraft(settings, transport))
  }, [open, settings, transport])

  // Auto-detect SMTP settings based on email (debounced)
  useEffect(() => {
    const domain = getEmailDomain(email)

    if (!domain) {
      setSmtpConfig(null)
      return
    }

    const timer = setTimeout(() => {
      if (SMTP_CONFIGS[domain]) {
        const config = SMTP_CONFIGS[domain]
        setSmtpConfig(config)
        setSmtpHost(config.host)
        setSmtpPort(config.port.toString())
      } else {
        setSmtpConfig(null)
        if (!settings?.smtp_host) {
          setSmtpHost("")
          setSmtpPort("")
        }
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [email, settings?.smtp_host])

  const isSaving = fetcher.state === "submitting"
  const isSaved = fetcher.state === "idle" && fetcher.data?.success

  const isTesting = testFetcher.state === "submitting"
  const testSuccess = testFetcher.state === "idle" && testFetcher.data?.success && testResultValid

  const isClearing = clearFetcher.state === "submitting"
  const isCleared = clearFetcher.state === "idle" && clearFetcher.data?.success

  useEffect(() => {
    if (testSuccess) {
      setTestPassed(true)
    }
  }, [testSuccess])

  useEffect(() => {
    setTestPassed(false)
    setTestResultValid(false)
  }, [email, password, smtpUsername, smtpHost, smtpPort, selectedTransport])

  useEffect(() => {
    if (clearFetcher.state === "idle" && clearFetcher.data?.success) {
      setEmail("")
      setPassword("")
      setSmtpUsername("")
      setSmtpHost("")
      setSmtpPort("")
      setSmtpConfig(null)
      setTestPassed(false)
      setTestResultValid(false)
    }
  }, [clearFetcher.state, clearFetcher.data])

  // Each method keeps its own draft: leaving hands the other one a blank
  // slate, and coming back restores what the stored row holds.
  const switchTransport = (next: MailTransport) => {
    if (next === selectedTransport) return
    setSelectedTransport(next)
    applyDraft(draftFor(next))
  }

  const handleTestEmail = () => {
    setTestResultValid(true)

    const formData = new FormData()
    formData.append("notification_email", email)
    formData.append("notification_email_password", password)
    formData.append("smtp_username", smtpUsername)
    formData.append("smtp_host", smtpHost)
    formData.append("smtp_port", smtpPort)
    formData.append("transport", selectedTransport)

    testFetcher.submit(formData, {
      method: "post",
      action: "/settings/notifications/test"
    })
  }

  const handleDisableNotifications = () => {
    clearFetcher.submit(null, {
      method: "delete",
      action: "/settings/notifications"
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] h-[90vh] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-y-auto p-6 flex flex-col items-start">
        <DialogHeader className="mb-6 w-full">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Email Notifications</CardTitle>
            <CardDescription>
              Configure email notifications for all form submissions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fetcher.Form method="post" action="/settings/notifications">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Sending method</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={smtpLocked ? "outline" : "default"}
                      onClick={() => switchTransport("smtp")}
                    >
                      SMTP
                    </Button>
                    {cloudflareAvailable && (
                      <Button
                        type="button"
                        variant={smtpLocked ? "default" : "outline"}
                        onClick={() => switchTransport("cloudflare")}
                      >
                        Cloudflare
                      </Button>
                    )}
                  </div>
                  <input
                    type="hidden"
                    name="transport"
                    value={selectedTransport}
                  />
                  <p className="text-sm text-muted-foreground">
                    {smtpLocked
                      ? "Sent through this Worker's Cloudflare send binding. The address must be on a domain onboarded for Email Sending."
                      : "Signed in to your provider's SMTP server with the credentials below."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Your Email
                  </Label>
                  <Input
                    id="email"
                    name="notification_email"
                    type="email"
                    placeholder="your.email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={CLEAR_PLACEHOLDER}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Form submission notifications are sent to this address
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    SMTP Password
                  </Label>
                  <Input
                    id="password"
                    name="notification_email_password"
                    type="password"
                    placeholder="Enter your SMTP password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={smtpLocked}
                    className={cn(LOCKED_FIELD, CLEAR_PLACEHOLDER)}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    {smtpConfig ? smtpConfig.hint : "Use your email password or app-specific password"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="smtp-username"
                    className={cn("flex items-center gap-2", lockedLabel)}
                  >
                    <User className="h-4 w-4" />
                    SMTP Username
                  </Label>
                  <Input
                    id="smtp-username"
                    name="smtp_username"
                    type="text"
                    placeholder="Leave blank to use your email"
                    value={smtpUsername}
                    onChange={(e) => setSmtpUsername(e.target.value)}
                    disabled={smtpLocked}
                    className={cn(LOCKED_FIELD, CLEAR_PLACEHOLDER)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Optional. Leave blank to log in with your email address. Some providers need a fixed login instead, e.g. api_token for Cloudflare Email Service.
                  </p>
                </div>

                {/* A recognised provider fills these in, so they show
                    on every domain and lock when it did the filling. */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="smtp-host"
                      className={cn("flex items-center gap-2", lockedLabel)}
                    >
                      <Server className="h-4 w-4" />
                      SMTP Host
                    </Label>
                    <Input
                      id="smtp-host"
                      name="smtp_host"
                      type="text"
                      placeholder="smtp.example.com"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      disabled={hostLocked}
                      className={cn(LOCKED_FIELD, CLEAR_PLACEHOLDER)}
                      required
                    />
                    <p className="text-sm text-muted-foreground">
                      The SMTP server address for your email provider
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="smtp-port" className={lockedLabel}>
                      SMTP Port
                    </Label>
                    <Input
                      id="smtp-port"
                      name="smtp_port"
                      type="number"
                      placeholder="587"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      disabled={hostLocked}
                      className={cn(LOCKED_FIELD, CLEAR_PLACEHOLDER)}
                      required
                    />
                    <p className="text-sm text-muted-foreground">
                      587 uses STARTTLS and 465 uses implicit TLS. Port 25 is blocked on Cloudflare Workers.
                    </p>
                  </div>
                </div>

                {/* A disabled input is left out of the submission, so every
                    value the current method does not let the operator edit
                    travels as a hidden one and the save writes it back. */}
                {smtpLocked && (
                  <>
                    <input
                      type="hidden"
                      name="notification_email_password"
                      value={password}
                    />
                    <input
                      type="hidden"
                      name="smtp_username"
                      value={smtpUsername}
                    />
                  </>
                )}
                  {hostLocked && (
                    <>
                      <input type="hidden" name="smtp_host" value={smtpHost} />
                      <input type="hidden" name="smtp_port" value={smtpPort} />
                    </>
                  )}

                <div className="pt-4 space-y-3">
                  {testFetcher.data?.error && testResultValid && (
                    <p className="text-sm text-destructive">
                      {testFetcher.data.error}
                    </p>
                  )}
                  <TooltipProvider>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <ResultButton
                          type="button"
                          variant="outline"
                          isSubmitting={isTesting}
                          isSuccess={testSuccess}
                          loadingText="Sending..."
                          successText="Test email sent!"
                          disabled={
                            !email ||
                            (!smtpLocked && (!password || !smtpHost || !smtpPort))
                          }
                          onClick={handleTestEmail}
                          className="w-full sm:w-auto"
                        >
                          Send test email
                        </ResultButton>
                        <Tooltip open={!testPassed ? undefined : false}>
                          <TooltipTrigger asChild>
                            <span className="w-full sm:w-auto">
                              <ResultButton
                                type="submit"
                                isSubmitting={isSaving}
                                isSuccess={isSaved}
                                loadingText="Saving..."
                                successText="Saved!"
                                disabled={!testPassed}
                                className="w-full sm:w-auto"
                              >
                                Save Settings
                              </ResultButton>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Send a test email first to verify your settings</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                        {settings && (
                          <ResultButton
                            type="button"
                            variant="outline"
                            isSubmitting={isClearing}
                            isSuccess={isCleared}
                            loadingText="Disabling..."
                            successText="Disabled!"
                            className="w-full sm:w-auto text-destructive hover:text-destructive"
                            onClick={handleDisableNotifications}
                          >
                            Disable Notifications
                          </ResultButton>
                        )}
                      </div>
                  </TooltipProvider>
                </div>
              </div>
            </fetcher.Form>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
