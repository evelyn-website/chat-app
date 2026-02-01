package s3store

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Store interface {
	PresignUpload(ctx context.Context, key string, expires time.Duration, contentLength int64) (string, error)
	PresignDownload(ctx context.Context, key string, expires time.Duration) (string, error)
	GetS3Client() *s3.Client
	GetBucket() string
}

type s3Store struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
}

func New(cfg aws.Config, bucket string) Store {
	client := s3.NewFromConfig(cfg)
	presigner := s3.NewPresignClient(client)
	return &s3Store{
		client:    client,
		presigner: presigner,
		bucket:    bucket,
	}
}

func (s *s3Store) PresignUpload(ctx context.Context, key string, expires time.Duration, contentLength int64) (string, error) {
	out, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        &s.bucket,
		Key:           &key,
		ContentType:   aws.String("application/octet-stream"),
		ContentLength: aws.Int64(contentLength),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expires
	})
	if err != nil {
		return "", err
	}
	return out.URL, nil
}

func (s *s3Store) PresignDownload(ctx context.Context, key string, expires time.Duration) (string, error) {
	out, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &s.bucket,
		Key:    &key,
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expires
	})
	if err != nil {
		return "", err
	}
	return out.URL, nil
}

func (s *s3Store) GetS3Client() *s3.Client {
	return s.client
}

func (s *s3Store) GetBucket() string {
	return s.bucket
}
