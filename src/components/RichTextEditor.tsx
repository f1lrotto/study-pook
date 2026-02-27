import { useEffect, useRef, type ChangeEvent } from 'react'

import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useMutation } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { parseStorageImageUri } from '../lib/notes/markdownFile'

const asImageFiles = (fileList: FileList | null) =>
  Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'))

const normalizeMarkdown = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const toStorageImageUri = (storageId: string, imageName?: string) => {
  const name = encodeURIComponent((imageName ?? 'image').trim() || 'image')
  return `convex://storage/${storageId}?name=${name}`
}

type RichTextEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  imageUrlMap?: Record<string, string>
}

const markdownImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g

const rewriteMarkdownImageUrls = (markdown: string, replaceUrl: (url: string) => string) =>
  markdown.replace(markdownImagePattern, (_match, alt, url, title = '') => {
    const nextUrl = replaceUrl(String(url))
    return `![${alt}](${nextUrl}${title})`
  })

const toEditorMarkdown = (markdown: string, imageUrlMap: Record<string, string>) =>
  rewriteMarkdownImageUrls(markdown, (url) => {
    const parsed = parseStorageImageUri(url)
    return parsed ? (imageUrlMap[parsed.storageId] ?? url) : url
  })

const buildResolvedToCanonicalMap = (markdown: string, imageUrlMap: Record<string, string>) => {
  const resolvedToCanonical = new Map<string, string>()

  rewriteMarkdownImageUrls(markdown, (url) => {
    const parsed = parseStorageImageUri(url)
    if (!parsed) {
      return url
    }

    const resolved = imageUrlMap[parsed.storageId]
    if (resolved) {
      resolvedToCanonical.set(resolved, url)
    }

    return url
  })

  return resolvedToCanonical
}

const toCanonicalMarkdown = (markdown: string, resolvedToCanonical: Map<string, string>) =>
  rewriteMarkdownImageUrls(markdown, (url) => resolvedToCanonical.get(url) ?? url)

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  imageUrlMap,
}: RichTextEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const getUploadUrl = useMutation(api.study.getUploadUrl)
  const resolvedToCanonicalRef = useRef(new Map<string, string>())
  const safeImageUrlMap = imageUrlMap ?? {}
  const normalizedValue = normalizeMarkdown(value)
  const editorContent = normalizeMarkdown(toEditorMarkdown(normalizedValue, safeImageUrlMap))
  const resolvedToCanonical = buildResolvedToCanonicalMap(normalizedValue, safeImageUrlMap)

  const uploadImage = async (file: File) => {
    const uploadUrl = await getUploadUrl({})

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name,
      },
      body: file,
    })

    if (!response.ok) {
      throw new Error(`Image upload failed (${response.status} ${response.statusText})`)
    }

    const payload = (await response.json()) as { storageId?: string }
    if (!payload.storageId) {
      throw new Error('Image upload response missing storageId')
    }

    return toStorageImageUri(payload.storageId, file.name)
  }

  const editor = useEditor({
    content: editorContent,
    contentType: 'markdown',
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Markdown,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Image.configure({
        allowBase64: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Napíš poznámky…',
      }),
    ],
    onUpdate: ({ editor }) => {
      onChange(
        normalizeMarkdown(
          toCanonicalMarkdown(editor.getMarkdown(), resolvedToCanonicalRef.current),
        ),
      )
    },
    editorProps: {
      handlePaste: (view, event) => {
        if (disabled) {
          return false
        }

        const clipboardItems = Array.from(event.clipboardData?.items ?? [])
        const imageFiles = clipboardItems
          .filter((item) => item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file))

        if (!imageFiles.length) {
          return false
        }

        event.preventDefault()

        const imageNode = view.state.schema.nodes.image
        if (!imageNode) {
          return false
        }

        void Promise.all(
          imageFiles.map(async (file) => {
            const src = await uploadImage(file)
            const node = imageNode.create({ src, alt: file.name || 'image' })
            const transaction = view.state.tr.replaceSelectionWith(node).scrollIntoView()
            view.dispatch(transaction)
          }),
        ).catch((error) => {
          console.error(error)
        })

        return true
      },
    },
  })

  useEffect(() => {
    resolvedToCanonicalRef.current = resolvedToCanonical
  }, [resolvedToCanonical])

  useEffect(() => {
    if (!editor) {
      return
    }

    const currentCanonical = normalizeMarkdown(
      toCanonicalMarkdown(editor.getMarkdown(), resolvedToCanonical),
    )

    if (currentCanonical === normalizedValue) {
      return
    }

    editor.commands.setContent(editorContent, {
      contentType: 'markdown',
      emitUpdate: false,
    })
  }, [editor, editorContent, normalizedValue, resolvedToCanonical])

  const insertImage = async (file: File) => {
    if (!editor || disabled) {
      return
    }

    const src = await uploadImage(file)
    editor
      .chain()
      .focus()
      .setImage({ src, alt: file.name || 'image' })
      .run()
  }

  const onImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = asImageFiles(event.target.files)

    void Promise.all(files.map(insertImage)).catch((error) => {
      console.error(error)
    })

    event.target.value = ''
  }

  if (!editor) {
    return null
  }

  const triggerImageDialog = () => imageInputRef.current?.click()

  const setOrUnsetLink = () => {
    if (disabled) {
      return
    }

    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
      return
    }

    const previousHref = String(editor.getAttributes('link').href ?? '').trim()
    const rawUrl = window.prompt('Zadaj URL odkazu', previousHref || 'https://')
    if (!rawUrl) {
      return
    }

    const url = rawUrl.trim()
    if (!url) {
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar">
        <div className="rich-editor-toolbar-group">
          <button
            className={`rich-editor-tool ${editor.isActive('bold') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleBold().run()}
            type="button"
          >
            B
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('italic') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            type="button"
          >
            I
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('code') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleCode().run()}
            type="button"
          >
            {'</>'}
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('link') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={setOrUnsetLink}
            type="button"
          >
            Link
          </button>
        </div>

        <span aria-hidden className="rich-editor-toolbar-separator" />

        <div className="rich-editor-toolbar-group">
          <button
            className={`rich-editor-tool ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            type="button"
          >
            H1
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            type="button"
          >
            H2
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            type="button"
          >
            H3
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('bulletList') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Odrážkový zoznam"
            type="button"
          >
            UL
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('orderedList') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Číslovaný zoznam"
            type="button"
          >
            OL
          </button>
          <button
            className={`rich-editor-tool ${editor.isActive('blockquote') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            type="button"
          >
            Citát
          </button>
        </div>

        <span aria-hidden className="rich-editor-toolbar-separator" />

        <div className="rich-editor-toolbar-group">
          <button
            className={`rich-editor-tool ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
            disabled={disabled}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code blok"
            type="button"
          >
            Code
          </button>
          <button
            className="rich-editor-tool"
            disabled={disabled}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            type="button"
          >
            HR
          </button>
          <button
            className="rich-editor-tool"
            disabled={disabled}
            onClick={triggerImageDialog}
            title="Vložiť obrázok"
            type="button"
          >
            Img
          </button>
        </div>

        <span aria-hidden className="rich-editor-toolbar-separator" />

        <div className="rich-editor-toolbar-group">
          <button
            aria-label="Undo"
            className="rich-editor-tool rich-editor-tool-icon"
            disabled={disabled}
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M9 7H19a4 4 0 0 1 0 8h-7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M9 7l3-3M9 7l3 3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          <button
            aria-label="Redo"
            className="rich-editor-tool rich-editor-tool-icon"
            disabled={disabled}
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M15 7H5a4 4 0 0 0 0 8h7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M15 7l-3-3M15 7l-3 3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
      </div>

      <EditorContent className="rich-editor-content" editor={editor} />

      <input
        accept="image/*"
        hidden
        onChange={onImageInputChange}
        ref={imageInputRef}
        type="file"
      />
    </div>
  )
}
