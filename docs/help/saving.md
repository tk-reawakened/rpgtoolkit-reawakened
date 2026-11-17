# Saving and external file changes

Use **Save active editor** or **Ctrl+S** (**Cmd+S** on macOS) to save the editor you are working in. **Save All Open Documents** saves all open documents with unsaved changes. The editor shows save failures and conflicts where you can resolve them.

## Changes made by another program

Some hosts can watch project files and report changes while you work. When file watching is unavailable, external changes are checked when you save instead.

Before writing, the editor compares the file with the version it last read or saved. If it finds a change, it stops the save and shows a conflict. Your edits remain available while you choose how to resolve it. The choices depend on the host: keeping your edits and reloading the disk version are offered when supported.

The comparison and write are separate operations. A change another program makes after the comparison but before the write can still be replaced. This is a [known save limitation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2207), not a guarantee that simultaneous writes are safe.
