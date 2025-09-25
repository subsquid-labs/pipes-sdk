import fs from 'node:fs/promises'
import path from 'node:path'

export async function loadSqlFiles(directoryOrFile: string): Promise<string[]> {
    let sqlFiles: string[] = []

    if (directoryOrFile.endsWith('.sql')) {
        sqlFiles = [directoryOrFile]
    } else {
        const files = await fs.readdir(directoryOrFile)
        sqlFiles = files.filter((file) => path.extname(file) === '.sql').map((file) => path.join(directoryOrFile, file))
    }

    const contents = await Promise.all(sqlFiles.map((file) => fs.readFile(file, 'utf-8')))

    return contents.flatMap((table) => table.split(';').filter((t) => t.trim().length > 0))
}
