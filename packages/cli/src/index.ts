import { program } from "commander";
import { InitConfig } from "./commands/init/cli.js";

program.name("pipes").description("Subsquid Pipes CLI").version("0.1.0");

program
  .command("init")
  .description("Initialize a new pipe project")
  .action(async () => {
    const initConfig = new InitConfig();
    await initConfig.run();
  });

program.parse();
