package checkers

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// Assertion modes, mirroring monitor.assertionType. Anything unrecognized
// falls back to Contains, which is what every row created before these
// existed carries.
const (
	AssertContains = "Contains"
	AssertRegex    = "Regex"
	AssertJSONPath = "JsonPath"
)

// compiledPatterns caches one compiled *regexp.Regexp per pattern. A monitor's
// pattern is fixed between edits but recompiled on every check otherwise, and
// RE2 compilation is the expensive half of a regex assertion.
var compiledPatterns sync.Map // string -> *regexp.Regexp

func patternFor(pattern string) (*regexp.Regexp, error) {
	if cached, ok := compiledPatterns.Load(pattern); ok {
		return cached.(*regexp.Regexp), nil
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	compiledPatterns.Store(pattern, compiled)
	return compiled, nil
}

// assertionFailure returns the failure message for a monitor's content
// assertion, or "" when it passes (or there's nothing to assert). Mirrors
// the assertion half of buildAssertion() in the monitor router's validation:
// whatever passes validation there is what this has to be able to evaluate.
func assertionFailure(assertionType, keyword, jsonPath string, inverted bool, body string) string {
	switch assertionType {
	case AssertRegex:
		return regexFailure(keyword, inverted, body)
	case AssertJSONPath:
		return jsonPathFailure(jsonPath, keyword, inverted, body)
	default:
		return containsFailure(keyword, inverted, body)
	}
}

func containsFailure(keyword string, inverted bool, body string) string {
	if keyword == "" {
		return ""
	}
	found := strings.Contains(body, keyword)
	if inverted {
		if found {
			return fmt.Sprintf("Response body contains %q", keyword)
		}
		return ""
	}
	if !found {
		return fmt.Sprintf("Response body does not contain %q", keyword)
	}
	return ""
}

func regexFailure(pattern string, inverted bool, body string) string {
	if pattern == "" {
		return ""
	}
	// The monitor router rejects a pattern that doesn't compile, so reaching
	// this means the row was hand-edited — report it rather than passing a
	// check nobody actually asserted anything about.
	compiled, err := patternFor(pattern)
	if err != nil {
		return fmt.Sprintf("Invalid regular expression %q: %s", pattern, err)
	}

	found := compiled.MatchString(body)
	if inverted {
		if found {
			return fmt.Sprintf("Response body matches /%s/", pattern)
		}
		return ""
	}
	if !found {
		return fmt.Sprintf("Response body does not match /%s/", pattern)
	}
	return ""
}

// jsonPathFailure resolves `path` against the JSON body and compares what it
// finds to `expected`. A blank `expected` asserts only that the path resolves
// to something — the common "this key exists at all" check.
func jsonPathFailure(path, expected string, inverted bool, body string) string {
	if path == "" {
		return ""
	}

	var document any
	if err := json.Unmarshal([]byte(body), &document); err != nil {
		return fmt.Sprintf("Response body is not valid JSON: %s", err)
	}

	value, ok := evalJSONPath(document, path)
	if !ok {
		if inverted {
			return ""
		}
		return fmt.Sprintf("JSON path %s did not match anything", path)
	}

	actual := formatJSONValue(value)
	if expected == "" {
		if inverted {
			return fmt.Sprintf("JSON path %s resolved to %s", path, actual)
		}
		return ""
	}

	if actual == expected {
		if inverted {
			return fmt.Sprintf("JSON path %s is %s", path, actual)
		}
		return ""
	}
	if inverted {
		return ""
	}
	return fmt.Sprintf("JSON path %s is %s, expected %q", path, actual, expected)
}

// formatJSONValue renders a decoded JSON value the way the expected-value box
// in the monitor form is typed: bare strings without quotes, numbers without
// a trailing ".0", booleans and null as their literals. Objects and arrays
// come back as compact JSON, so `$.items` can still be asserted against.
func formatJSONValue(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(encoded)
	}
}

// evalJSONPath walks the dotted/bracketed subset of JSONPath the monitor form
// accepts: a leading `$`, `.key`, `["key"]` and `[0]`. Deliberately not the
// full spec — no filters, wildcards or recursive descent — because a health
// endpoint assertion is a single scalar lookup, and a small hand-written
// walker keeps the workers dependency-free.
func evalJSONPath(document any, path string) (any, bool) {
	tokens, err := parseJSONPath(path)
	if err != nil {
		return nil, false
	}

	current := document
	for _, token := range tokens {
		if token.index >= 0 {
			array, ok := current.([]any)
			if !ok || token.index >= len(array) {
				return nil, false
			}
			current = array[token.index]
			continue
		}

		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		next, ok := object[token.key]
		if !ok {
			return nil, false
		}
		current = next
	}
	return current, true
}

// A path step: either a map key or (index >= 0) an array subscript.
type pathToken struct {
	key   string
	index int
}

// ParseJSONPath validates the supported subset without evaluating it, so the
// monitor router's Go-side equivalent and the checker agree on what's legal.
func ParseJSONPath(path string) error {
	_, err := parseJSONPath(path)
	return err
}

func parseJSONPath(path string) ([]pathToken, error) {
	rest := strings.TrimSpace(path)
	rest = strings.TrimPrefix(rest, "$")

	var tokens []pathToken
	for rest != "" {
		switch {
		case strings.HasPrefix(rest, "."):
			rest = rest[1:]
			end := strings.IndexAny(rest, ".[")
			if end == -1 {
				end = len(rest)
			}
			key := rest[:end]
			if key == "" {
				return nil, fmt.Errorf("empty key in JSON path")
			}
			tokens = append(tokens, pathToken{key: key, index: -1})
			rest = rest[end:]

		case strings.HasPrefix(rest, "["):
			end := strings.Index(rest, "]")
			if end == -1 {
				return nil, fmt.Errorf("unclosed [ in JSON path")
			}
			inner := strings.TrimSpace(rest[1:end])
			rest = rest[end+1:]

			if quoted := strings.Trim(inner, `"'`); quoted != inner {
				if quoted == "" {
					return nil, fmt.Errorf("empty key in JSON path")
				}
				tokens = append(tokens, pathToken{key: quoted, index: -1})
				continue
			}

			index, err := strconv.Atoi(inner)
			if err != nil || index < 0 {
				return nil, fmt.Errorf("invalid array index %q in JSON path", inner)
			}
			tokens = append(tokens, pathToken{index: index})

		default:
			// A path that starts with a bare key ("status" rather than
			// "$.status") is a common enough slip to just accept.
			end := strings.IndexAny(rest, ".[")
			if end == -1 {
				end = len(rest)
			}
			tokens = append(tokens, pathToken{key: rest[:end], index: -1})
			rest = rest[end:]
		}
	}

	if len(tokens) == 0 {
		return nil, fmt.Errorf("JSON path selects the whole document")
	}
	return tokens, nil
}
