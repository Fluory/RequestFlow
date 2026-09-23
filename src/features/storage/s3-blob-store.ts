import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

export interface StorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// S3 adapter behind the `BlobStore` port (ADR-0001 D5). The bucket is private: no ACLs, no
// public URLs – files are served only through authenticated app routes.
export class S3BlobStore {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(settings: StorageSettings) {
    this.bucket = settings.bucket;
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      maxAttempts: 2,
    });
  }

  /** Reachability and credentials check for /api/health. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Idempotent: creating an existing bucket owned by us is not an error. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) throw error;
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (error instanceof S3ServiceException && ["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) return;
      throw error;
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
