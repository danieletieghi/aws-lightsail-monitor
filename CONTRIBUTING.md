# Contributing to AWS Lightsail Monitor

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How to Contribute

### Reporting Issues

1. Check existing issues to avoid duplicates
2. Use issue templates when available
3. Include:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, AWS region)
   - Relevant logs or error messages

### Suggesting Enhancements

1. Open an issue with the "enhancement" label
2. Describe the feature and its benefits
3. Provide use cases
4. Consider implementation approach

### Contributing Code

#### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/your-username/aws-lightsail-monitor.git
cd aws-lightsail-monitor
git remote add upstream https://github.com/original/aws-lightsail-monitor.git
```

#### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

#### 3. Make Changes

- Follow existing code style
- Add tests for new functionality
- Update documentation as needed
- Keep commits focused and atomic

#### 4. Test Your Changes

```bash
# Run tests
npm test

# Test locally with SAM
sam local invoke MonitorFunction -e test-event.json

# Lint your code
npm run lint
```

#### 5. Commit Guidelines

Use clear, descriptive commit messages:

```
feat: Add support for custom HTTP headers
fix: Resolve timeout issue with large responses
docs: Update deployment guide with new parameters
test: Add unit tests for health check service
chore: Update dependencies
```

#### 6. Submit Pull Request

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill out the PR template
4. Link related issues
5. Wait for review

## Development Setup

### Prerequisites

- Node.js 18.x or later
- AWS SAM CLI
- AWS CLI configured
- Git

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create test configuration:
   ```bash
   cp config/config.example.json config/config.test.json
   ```

3. Run tests:
   ```bash
   npm test
   ```

### Project Structure

```
src/
├── handlers/       # Lambda function handlers
├── services/       # Business logic services
└── utils/          # Utility functions

tests/
├── unit/          # Unit tests
└── integration/   # Integration tests

docs/              # Documentation
config/            # Configuration files
```

## Testing Guidelines

### Unit Tests

- Test individual functions in isolation
- Mock external dependencies
- Aim for >80% code coverage
- Use descriptive test names

Example:
```javascript
describe('healthCheck', () => {
  it('should return healthy status for 200 response', async () => {
    // Test implementation
  });
});
```

### Integration Tests

- Test interactions between components
- Use test AWS resources when possible
- Clean up resources after tests

## Code Style

### JavaScript

- Use ES6+ features
- Async/await over callbacks
- Meaningful variable names
- JSDoc comments for functions

### General

- 2 spaces for indentation
- No trailing whitespace
- LF line endings
- UTF-8 encoding

## Documentation

When adding features:

1. Update README.md if needed
2. Add configuration examples
3. Document new environment variables
4. Include usage examples
5. Update troubleshooting guide

## Review Process

### What We Look For

- Code quality and clarity
- Test coverage
- Documentation updates
- Breaking changes
- Security implications
- Performance impact

### Review Timeline

- Initial response: 2-3 days
- Review completion: 1 week
- Feel free to ping if no response

## Release Process

1. Maintainers merge to main
2. Version bump following semver
3. Update CHANGELOG.md
4. Create GitHub release
5. Publish to npm (if applicable)

## Questions?

- Open a discussion on GitHub
- Check existing issues and PRs
- Review documentation

Thank you for contributing!