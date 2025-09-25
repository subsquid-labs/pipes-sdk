## SDK 1.0 — Current State

### Key Challenges

1. **Tight Coupling and Complexity**

    Although the SDK was designed with a modular approach, in practice many components are tightly coupled. This makes it extremely difficult to replace or extend parts of the system. Developers who attempt to make changes often find themselves forced to understand the entire SDK’s internal workings, creating a steep learning curve.

2. **Lack of Documentation and Tests**<br>

   The SDK currently has neither sufficient documentation nor adequate internal test coverage. As a result, introducing changes or enhancements carries high risk and requires significant effort.

3. **Standalone Design**

    SDK 1.0 was built to function as a standalone process. This architectural decision makes it challenging to embed the SDK into existing applications or workflows, limiting its flexibility.

4. **Rigid and Opinionated Approach**

    The SDK enforces a very opinionated development style, leaving little room for customization. Developers often find themselves constrained by the SDK’s assumptions rather than being supported by its abstractions.

5. **Lack of Client-Side Testing Framework**

    No built-in framework is provided for testing client-side applications. This omission increases friction for developers who need to validate their integrations.

6. **Minimal Community Adoption**

   These limitations—complexity, lack of flexibility, and insufficient support tools—have significantly hindered external contributions. As a result, the SDK has seen almost no meaningful engagement from the developer community since its release.

---

## SDK 2.0 — Goals

SDK 2.0 aims to address the shortcomings of the current version and provide a modern, flexible, and developer-friendly foundation.

### Objectives

1. **Focus on Business Logic**
    
    Enable developers to concentrate on building application-specific business logic rather than dealing with low-level blockchain implementation details.

2. **Code Reusability** 

   Promote code sharing and maintainability by extracting common functionality into reusable packages.

3. **Built-in Extensions** 

   Provide ready-to-use extensions that simplify common tasks, including:
    - A caching layer for the portal
      
    - Simplified handling of factory and child contracts
   
      https://github.com/subsquid-labs/sqd-pipes/blob/new/packages/streams/examples/factory.example.ts  
   
    - At least Postgres and Clickhouse integration, plus one streaming target like Apache kafka.
   
      https://github.com/subsquid-labs/sqd-pipes/blob/new/packages/streams/examples/clickhouse.example.ts

4. **Community Extension template**

  To foster a plugin developer community, we should provide a minimal scaffold that helps developers start building quickly.
  Creating an extension from scratch is not difficult, but offering the necessary boilerplate out of the box requires little effort and lowers the entry barrier.

  We can take inspiration from projects that already provide plugin scaffolding:

	- https://github.com/fastify/fastify-plugin
	- https://www.gatsbyjs.com/plugins/generator-gatsby-plugin
	- https://v4.webpack.js.org/guides/scaffolding

5. **Better observability**

   - Custom user metrics

     https://github.com/subsquid-labs/sqd-pipes/blob/new/packages/streams/examples/custom-metrics.example.ts

   - Profiling tools

     https://github.com/subsquid-labs/sqd-pipes/blob/new/packages/streams/examples/combining-pipes.example.ts
   
   - Offload logs to a centralized logging service (e.g. Sentry)
   
     https://github.com/subsquid-labs/sqd-pipes/blob/new/packages/streams/examples/custom-logs-transport.example.ts
     
6. **First-Class Bun Support** (optional)

   - Ensure that Bun is treated as a first-class runtime environment, making development faster and more efficient.

### TODO

- [ ] (chore, cd) [must have] Package management. How to ship this!

- [x] Add solana streams

- [x] Implement prometheus metrics
  - [x] Allow adding custom metrics to the pipeline by users
  - [ ] (feat) [must have] Define and expose all built-in metrics

- [x] Tracking progress
  - [x] "IN SYNC" should be calculated based on the last block number
  - [x] Bytes downloaded 
  - [ ] (feat) [could have] Number of requests to the portal esp. retries

- [x] Add profiling tools
  - [ ] (feat) [could have] Implement UI for interpretation 
  - [ ] (fix)  [could have] Inconsistent event ordering
  
- [x] Add a portal caching layer
  - [ ] (feat) [should have] Forks support. We need to implement buffer skipping unfinalized blocks and making cache more even in size
  - [x] (feat) [must have] Consistent query hash? Now it is slightly different between the one that calculated for the batch 
  - [ ] (chore)[should have] Add tests
  
- [x] Add factory and child contract support
  - [ ] (feat) [should have] Forks support
  - [x] Pass a decoded factory event to the child one
  - [ ] (feat) [could have] Add tests
  - [ ] (feat) [could have] Preload (?) child contracts from the portal
  
- [ ] Add Postgres support
  - [ ] (feat) [must have] Migrate TypeORM store from SDK 1.x
  
- [x] Add Clickhouse support
  - [x] Forks support
  - [x] Add tests
  - [ ] (fix) [could have] Forks on huge tables can cause issues

- [ ] (feat) [could have] Explore Drizzle support
- [ ] (feat) [could have] Add Kafka support

- [ ] (feat) [could have] Make everything Bun-compatible

