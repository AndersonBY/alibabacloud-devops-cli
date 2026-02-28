export class CliError extends Error {
  constructor(message: string, public readonly causeError?: unknown) {
    super(message);
    this.name = "CliError";
  }
}
