import { useState } from "react"
import { useParams } from "react-router"
import type { Route } from "./+types/forms.$formId.integration"
import { Copy, Check, HelpCircle } from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip"

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Integration | FormZero" },
    { name: "description", content: "Integrate your form with HTML, JavaScript, or React" },
  ];
};

export default function IntegrationPage() {
  const params = useParams()
  const formId = params.formId
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState("")

  // Use browser location to construct endpoint
  const formEndpoint = typeof window !== "undefined"
    ? `${window.location.origin}/api/forms/${formId}/submissions`
    : `/api/forms/${formId}/submissions`

  const htmlAction = redirectUrl.trim()
    ? `${formEndpoint}?redirect=${encodeURIComponent(redirectUrl.trim())}`
    : formEndpoint

  const handleCopyEndpoint = async () => {
    await navigator.clipboard.writeText(formEndpoint)
    setCopiedEndpoint(true)
    setTimeout(() => setCopiedEndpoint(false), 2000)
  }

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const htmlExample = `<style>
  .project-type {
    border: 0; padding: 0; margin: 0;
    font-family: system-ui, sans-serif;
  }
  .project-type legend {
    font-size: 0.875rem; font-weight: 500;
    margin-bottom: 0.375rem; padding: 0;
  }
  .project-type-options { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .project-type label { position: relative; cursor: pointer; }
  .project-type input {
    position: absolute; width: 1px; height: 1px;
    opacity: 0; pointer-events: none;
  }
  .project-type span {
    display: inline-block; padding: 0.125rem 0.5rem;
    font-size: 0.75rem; line-height: 1rem; font-weight: 500;
    border-radius: 0.375rem; border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(15, 23, 42, 0.04); color: rgba(15, 23, 42, 0.8);
    transition: all 0.3s ease;
  }
  .project-type label:hover span {
    background: rgba(15, 23, 42, 0.1); border-color: rgba(15, 23, 42, 0.4);
  }
  .project-type input:checked + span {
    background: #0f172a; border-color: #0f172a; color: #ffffff;
  }
  .project-type input:focus-visible + span {
    box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.2);
  }
</style>
<form action="${htmlAction}" method="POST">
  <input type="text" name="name" placeholder="Your Name" required />
  <input type="text" name="company" placeholder="Your Company" />
  <input type="email" name="email" placeholder="Your Email" required />
  <fieldset class="project-type">
    <legend>Project Type</legend>
    <div class="project-type-options">
      <label><input type="checkbox" name="projectType" value="AI agent" /><span>AI agent</span></label>
      <label><input type="checkbox" name="projectType" value="Automation" /><span>Automation</span></label>
      <label><input type="checkbox" name="projectType" value="Web app" /><span>Web app</span></label>
      <label><input type="checkbox" name="projectType" value="Mobile app" /><span>Mobile app</span></label>
      <label><input type="checkbox" name="projectType" value="Not sure yet" /><span>Not sure yet</span></label>
    </div>
  </fieldset>
  <textarea name="message" placeholder="Your Message"></textarea>
  <button type="submit">Submit</button>
</form>`

  const jsExample = `fetch('${formEndpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'John Doe',
    company: 'Acme Inc',
    email: 'john@example.com',
    projectType: ['Web app', 'Mobile app'],
    message: 'Hello!'
  })
})
  .then(response => response.json())
  .then(data => console.log('Success:', data))
  .catch(error => console.error('Error:', error))`

  const reactExample = `import { useState } from 'react'

const projectTypeStyles = [
  '.project-type { border: 0; padding: 0; margin: 0; font-family: system-ui, sans-serif; }',
  '.project-type legend { font-size: 0.875rem; font-weight: 500; margin-bottom: 0.375rem; padding: 0; }',
  '.project-type-options { display: flex; flex-wrap: wrap; gap: 0.375rem; }',
  '.project-type label { position: relative; cursor: pointer; }',
  '.project-type input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }',
  '.project-type span { display: inline-block; padding: 0.125rem 0.5rem; font-size: 0.75rem; line-height: 1rem; font-weight: 500; border-radius: 0.375rem; border: 1px solid rgba(15, 23, 42, 0.2); background: rgba(15, 23, 42, 0.04); color: rgba(15, 23, 42, 0.8); transition: all 0.3s ease; }',
  '.project-type label:hover span { background: rgba(15, 23, 42, 0.1); border-color: rgba(15, 23, 42, 0.4); }',
  '.project-type input:checked + span { background: #0f172a; border-color: #0f172a; color: #ffffff; }',
  '.project-type input:focus-visible + span { box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.2); }'
].join(' ')

const projectTypeOptions = ['AI agent', 'Automation', 'Web app', 'Mobile app', 'Not sure yet']

function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    email: '',
    message: ''
  })
  const [projectTypes, setProjectTypes] = useState([])
  const [status, setStatus] = useState('')

  const toggleProjectType = (type) => {
    setProjectTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus('sending')

    try {
      const response = await fetch('${formEndpoint}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, projectType: projectTypes })
      })

      if (response.ok) {
        setStatus('success')
        setFormData({ name: '', company: '', email: '', message: '' })
        setProjectTypes([])
      } else {
        setStatus('error')
      }
    } catch (error) {
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <style>{projectTypeStyles}</style>
      <input
        type="text"
        placeholder="Your Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        required
      />
      <input
        type="text"
        placeholder="Your Company"
        value={formData.company}
        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
      />
      <input
        type="email"
        placeholder="Your Email"
        value={formData.email}
        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        required
      />
      <fieldset className="project-type">
        <legend>Project Type</legend>
        <div className="project-type-options">
          {projectTypeOptions.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                name="projectType"
                value={type}
                checked={projectTypes.includes(type)}
                onChange={() => toggleProjectType(type)}
              />
              <span>{type}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <textarea
        placeholder="Your Message"
        value={formData.message}
        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
      />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending...' : 'Submit'}
      </button>
      {status === 'success' && <p>Message sent successfully!</p>}
      {status === 'error' && <p>Error sending message. Please try again.</p>}
    </form>
  )
}`

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
          <CardDescription>
            Use this as your HTML form <code className="rounded bg-muted px-1 py-0.5 text-xs">action</code> URL or just send JSON to it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
              {formEndpoint}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyEndpoint}
              className="shrink-0 w-full sm:w-auto sm:px-3"
            >
              {copiedEndpoint ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span className="sm:hidden ml-2">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span className="sm:hidden ml-2">Copy Endpoint</span>
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integration Examples</CardTitle>
          <CardDescription>
            Choose your preferred method to submit data to your form.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="html" className="w-full">
            <TabsList>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="javascript">JavaScript</TabsTrigger>
              <TabsTrigger value="react">React</TabsTrigger>
            </TabsList>

            <TabsContent value="html" className="mt-3 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="redirect-url">Redirect URL (optional)</Label>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="How this works"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>
                          We append <code>?redirect=</code> to the form&apos;s action URL in the snippet below. It&apos;s a copy-and-paste helper - nothing is saved on your form.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="redirect-url"
                  type="url"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://yoursite.com/thanks.html"
                />
                <p className="text-xs text-muted-foreground">
                  After submission, users are redirected here. Leave empty to send them back to the page they came from.
                </p>
              </div>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyCode(htmlExample)}
                  className="absolute top-2 right-2 z-10 h-7 px-2 text-xs"
                >
                  {copiedCode ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <Highlight
                  theme={themes.vsDark}
                  code={htmlExample}
                  language="markup"
                >
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre
                      className={className}
                      style={{
                        ...style,
                        margin: 0,
                        borderRadius: "0.375rem",
                        fontSize: "0.75rem",
                        padding: "0.75rem",
                        overflowX: "auto",
                      }}
                    >
                      {tokens.map((line, i) => (
                        <div key={i} {...getLineProps({ line })}>
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </div>
                      ))}
                    </pre>
                  )}
                </Highlight>
              </div>
            </TabsContent>

            <TabsContent value="javascript" className="mt-3">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyCode(jsExample)}
                  className="absolute top-2 right-2 z-10 h-7 px-2 text-xs"
                >
                  {copiedCode ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <Highlight
                  theme={themes.vsDark}
                  code={jsExample}
                  language="javascript"
                >
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre
                      className={className}
                      style={{
                        ...style,
                        margin: 0,
                        borderRadius: "0.375rem",
                        fontSize: "0.75rem",
                        padding: "0.75rem",
                        overflowX: "auto",
                      }}
                    >
                      {tokens.map((line, i) => (
                        <div key={i} {...getLineProps({ line })}>
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </div>
                      ))}
                    </pre>
                  )}
                </Highlight>
              </div>
            </TabsContent>

            <TabsContent value="react" className="mt-3">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyCode(reactExample)}
                  className="absolute top-2 right-2 z-10 h-7 px-2 text-xs"
                >
                  {copiedCode ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <Highlight
                  theme={themes.vsDark}
                  code={reactExample}
                  language="jsx"
                >
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre
                      className={className}
                      style={{
                        ...style,
                        margin: 0,
                        borderRadius: "0.375rem",
                        fontSize: "0.75rem",
                        padding: "0.75rem",
                        overflowX: "auto",
                      }}
                    >
                      {tokens.map((line, i) => (
                        <div key={i} {...getLineProps({ line })}>
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </div>
                      ))}
                    </pre>
                  )}
                </Highlight>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
