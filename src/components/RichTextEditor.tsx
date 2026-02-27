import { useRef, type ChangeEvent } from 'react'

import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'

type RichTextEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const asImageFiles = (fileList: FileList | null) =>
  Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'))

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    content: value || '<p></p>',
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
      Image.configure({
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Napíš poznámky…',
      }),
    ],
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      handlePaste: (view, event) => {
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

        for (const file of imageFiles) {
          const reader = new FileReader()
          reader.onload = () => {
            const src = typeof reader.result === 'string' ? reader.result : ''
            if (!src) {
              return
            }

            const node = imageNode.create({ src })
            const transaction = view.state.tr.replaceSelectionWith(node).scrollIntoView()
            view.dispatch(transaction)
          }
          reader.readAsDataURL(file)
        }

        return true
      },
    },
  })

  const insertImage = (file: File) => {
    if (!editor) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (!src) {
        return
      }

      editor.chain().focus().setImage({ src }).run()
    }
    reader.readAsDataURL(file)
  }

  const onImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = asImageFiles(event.target.files)

    for (const file of files) {
      insertImage(file)
    }

    event.target.value = ''
  }

  if (!editor) {
    return null
  }

  const triggerImageDialog = () => imageInputRef.current?.click()

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar">
        <button
          className={`rich-editor-tool ${editor.isActive('bold') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          type="button"
        >
          B
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('italic') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          type="button"
        >
          I
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          type="button"
        >
          H2
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          type="button"
        >
          H3
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('bulletList') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          type="button"
        >
          Odrážky
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('orderedList') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          type="button"
        >
          Číslovanie
        </button>
        <button
          className={`rich-editor-tool ${editor.isActive('blockquote') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          type="button"
        >
          Citát
        </button>
        <button className="rich-editor-tool" onClick={triggerImageDialog} type="button">
          Obrázok
        </button>
        <button
          className="rich-editor-tool"
          onClick={() => editor.chain().focus().undo().run()}
          type="button"
        >
          Undo
        </button>
        <button
          className="rich-editor-tool"
          onClick={() => editor.chain().focus().redo().run()}
          type="button"
        >
          Redo
        </button>
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
