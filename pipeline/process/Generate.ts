import { Env } from "@pipeline/Env";
import { FileInput } from "@pipeline/File";
import { Database, ReportConfig } from "@pipeline/Types";
import { compress } from "@pipeline/compression/Compression";
import { Parser } from "@pipeline/parse/Parser";
import { DiscordParser } from "@pipeline/parse/parsers/DiscordParser";
import { MessengerParser } from "@pipeline/parse/parsers/MessengerParser";
import { TelegramParser } from "@pipeline/parse/parsers/TelegramParser";
import { WhatsAppParser } from "@pipeline/parse/parsers/WhatsAppParser";
import { DatabaseBuilder } from "@pipeline/process/DatabaseBuilder";

export const generateDatabase = async (files: FileInput[], config: ReportConfig, env: Env): Promise<Database> => {
    env.progress?.stat("total_files", files.length);

    const builder: DatabaseBuilder = new DatabaseBuilder(config, env);
    // load data needed for processing
    await builder.init();

    // create parser
    let parser: Parser | null = null;
    switch (config.platform) {
        case "discord":
            parser = new DiscordParser(builder);
            break;
        case "messenger":
            parser = new MessengerParser(builder);
            break;
        case "whatsapp":
            parser = new WhatsAppParser(builder);
            break;
        case "telegram":
            parser = new TelegramParser(builder);
            break;
        default:
            throw new Error(`Unknown platform: ${config.platform}`);
    }

    // parse and process all files
    let processed = 0;
    for (const file of parser.sortFiles(files)) {
        env.progress?.new("Processing", file.name);
        try {
            for await (const _ of parser.parse(file)) builder.process();
            builder.process(true);
        } catch (err) {
            if (err instanceof Error) {
                const newErr = new Error(`Error parsing file "${file.name}":\n\n${err.message}`);
                newErr.stack = err.stack;
                throw newErr;
            }
            // handled by WorkerApp.ts
            throw err;
        }
        env.progress?.done();
        env.progress?.stat("processed_files", ++processed);
    }

    // no longer needed
    parser = null;

    return builder.getDatabase();
};

// Returns the final data and HTML code
export const generateReport = async (
    database: Database,
    env: Env
): Promise<{
    data: string;
    html: string;
}> => {
    // compress data
    env.progress?.new("Compressing");
    const encodedData = compress(database);
    env.progress?.done();

    // build title to avoid HTML injections (just so it doesn't break)
    const title = database.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let html = await env.loadAsset("/report.html", "text");
    html = html.replace("[[TITLE]]", `${title} - Chat Analytics`);

    // we can't use replace for the data, if the data is too large it will cause a crash
    const template = "[[[DATA]]]";
    const dataTemplateLoc = html.indexOf(template);
    const finalHtml = html.slice(0, dataTemplateLoc) + encodedData + html.slice(dataTemplateLoc + template.length);

    return {
        data: encodedData,
        html: finalHtml,
    };
};
