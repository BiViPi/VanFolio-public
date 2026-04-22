# VanFolio Backup & Recovery Guide

VanFolio provides two backup mechanisms:

1. **Document Versioning** — Automatic snapshots of your documents
2. **Manual Backup** — Export your entire vault to an external location

## Document Versioning (Automatic)

VanFolio automatically creates snapshots of your documents as you edit. These snapshots are stored in your vault.

### View Version History

1. Open a document
2. Go to **View** → **Show History**
3. A timeline appears showing all saved versions
4. Click a version to preview or restore it

### Restore a Version

1. Open the version timeline
2. Click the version you want to restore
3. Click **Restore** button
4. The current document reverts to that version

### Version Storage

Versions are stored in your vault folder:
```
[Vault]/.vault/versions/[file-key]/
├── v1.snapshot
├── v2.snapshot
├── v3.snapshot
└── ...
```

Each snapshot includes metadata (timestamp, word count, change summary).

### Clear Version History

To free up space:

1. **Settings** → **Storage**
2. Click **Clear History** under a document
3. Confirm — all old versions are deleted

**Warning:** Deleted versions cannot be recovered.

## Manual Backup

Manual backup exports your entire vault (all files + versions) to a ZIP file.

### Create a Backup

1. Open **Settings** → **Backup**
2. Click **Backup Now**
3. Choose where to save the backup (e.g., USB drive, cloud folder)
4. Enter a name (default: `VanFolio-Backup-[date].zip`)
5. Click **Save**

The backup includes:
- All documents (`.md` files)
- All versions (`.snapshot` files)
- Settings and metadata

### Restore from Backup

To recover your vault:

1. Unzip the backup file: `VanFolio-Backup-[date].zip`
2. In VanFolio, go to **Settings** → **Vault**
3. Click **Change Vault Location**
4. Select the unzipped folder
5. Restart VanFolio

Your vault is restored with all documents and versions.

### Backup Frequency

**Manual backup only** — VanFolio does not automatically upload backups. You control when backups happen.

**Recommended schedule:**
- Before major edits
- Weekly (if editing regularly)
- Before upgrading VanFolio
- Before important deadlines

## Cloud Backup Strategy

To use cloud storage (OneDrive, Google Drive, Dropbox, iCloud):

### Option 1: Backup to Cloud Folder

1. Set backup destination to your cloud folder
2. Create backups regularly
3. Files sync automatically to cloud

Example paths:
```
Windows:  C:\Users\[User]\OneDrive\VanFolio-Backups\
macOS:    ~/Library/CloudStorage/OneDrive-Personal/VanFolio-Backups/
Linux:    ~/Documents/Dropbox/VanFolio-Backups/
```

### Option 2: Vault in Cloud Folder (Advanced)

Place your vault directly in cloud storage:

1. Close VanFolio
2. Move your vault to: `C:\Users\[User]\OneDrive\VanFolio\`
3. In VanFolio, go to **Settings** → **Vault** → **Change Vault Location**
4. Select the OneDrive folder
5. Restart VanFolio

**Risk:** Cloud sync conflicts if you edit on multiple devices simultaneously. Use Option 1 for safety.

## Disaster Recovery

### Vault Corrupted

1. Close VanFolio
2. Locate your vault folder (default: `~/VanFolio`)
3. Check if `.vault/` folder is still readable
4. Try opening a backup from your external drive (if available)
5. If all backups are corrupted, contact support

### Lost All Versions

If `.vault/versions/` is deleted or corrupted:

1. Document history is lost permanently
2. You still have the current document content
3. Restore from a previous manual backup if available

**Prevention:** Keep external backups on a separate device.

### Computer Crash, Vault on Local Drive

1. Recover your computer or get a new one
2. Restore from your last manual backup
3. All documents and versions up to backup date are restored

## Storage Usage

Check how much space your vault uses:

1. **Settings** → **Storage**
2. View breakdown by file and versions

### Free Up Space

If running low on disk space:

```
- Clear old versions: Settings → Storage → Clear history (per-file)
- Export and delete old documents: File → Export as HTML/PDF
- Move vault to external drive: Settings → Vault → Change location
```

## Best Practices

✅ **DO:**
- Create weekly backups to external media
- Test restores periodically (verify backups work)
- Use cloud storage for redundancy
- Keep at least 2 recent backups
- Document your backup locations

❌ **DON'T:**
- Rely on version history alone (can be cleared)
- Store backups on the same drive as your vault
- Ignore backup warnings
- Edit vault files directly on disk
- Use version history as primary backup

## FAQ

**Q: Does VanFolio auto-backup to the cloud?**  
A: No. All backups are manual. You choose when and where.

**Q: Can I restore a single document?**  
A: Yes. Open a backup ZIP, extract the `.md` file, and open it in VanFolio.

**Q: Where are versions stored?**  
A: In your vault folder under `.vault/versions/` (hidden folder).

**Q: Can I access versions without VanFolio?**  
A: Versions are binary files. You need VanFolio to restore them. Always keep document exports (HTML, PDF, DOCX) as secondary backups.

**Q: How often should I backup?**  
A: Depends on how frequently you edit. Weekly is recommended for active projects.

**Q: Can I backup to an external USB drive?**  
A: Yes. In backup dialog, navigate to the USB drive and save there.

---

**Questions?** See [README.md](../README.md) or open an issue on GitHub.
