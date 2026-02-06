// import UploadService from "@/services/upload.service";

class CompletionWorker {
  //   private uploadService = new UploadService();

  async run() {
    console.log("Worker started");
    // TODO: poll queue or scan DB for pending completion
  }
}

new CompletionWorker().run();
