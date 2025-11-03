CREATE TABLE "transfers" (
	"blockNumber" integer NOT NULL,
	"logIndex" integer NOT NULL,
	"transactionIndex" integer NOT NULL,
	"from" varchar NOT NULL,
	"to" varchar NOT NULL,
	"amount" numeric NOT NULL,
	"createdAt" timestamp,
	CONSTRAINT "transfers_blockNumber_transactionIndex_logIndex_pk" PRIMARY KEY("blockNumber","transactionIndex","logIndex")
);
