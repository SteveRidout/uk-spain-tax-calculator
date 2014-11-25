"use strict";

$(document).ready(function () {
	// These will all be populated in parseValues()
	var businessInputs = {},
		countryInputs = {},
		output = {},
		xe = {};

	// Parse numerical value from the <input> element with the given name
	var parse = function (name) {
		var element = $('[name=' + name + ']');
		var result = parseFloat(element.val());

		if (isNaN(result)) {
			element.addClass('invalid');
			return;
		}
		element.removeClass('invalid');
		return result;
	};

	var parseBands = function (name) {
		var element = $('[name=' + name + ']');
		var text = element.val();
		var lineRegExp = new RegExp('^\\s*([0-9\\.]+)\\s*-\\s*([0-9\\.]+)\\s*:\\s*([0-9\\.]+)$');
		var result = [];

		var parsedOk = _.every(text.split('\n'), function (line) {
			console.log('parsing line: ', line);
			var match = lineRegExp.exec(line);

			if (match === null) {
				if (line.trim().length > 0) {
					// couldn't parse line
					return false;
				} else {
					// line empty - just ignore
					return true;
				}
			}

			result.push({
				from: match[1],
				to:   match[2],
				rate: match[3]
			});
			return true;
		});

		if (!parsedOk) {
			element.addClass('invalid');
			return;
		}
		element.removeClass('invalid');
		return result;
	};

	var clearError = function (message) {
		$('.error-message').hide();
		$('.results').show();
	};

	var displayError = function (message) {
		$('.error-message')
			.text(message)
			.fadeIn();

		$('.results').hide();
	};

	var parseValues = function () {
		businessInputs.b2cRevenue = parse('b2c-revenue') || 0;
		businessInputs.b2bRevenue = parse('b2b-revenue') || 0;
		businessInputs.expenses   = parse('expenses') || 0;

		_.each(businessInputs, function (value) {
			if (value > 10000000) {
				displayError('Come on, now you\'re just being silly. We\'re taking about sole traders remember.');
			}
		});

		_.each(['gb', 'es'], function (country) {
			countryInputs[country] = {};
			countryInputs[country].code = country;
			countryInputs[country].vat = parse(country + '-vat');
			countryInputs[country].vatThreshold = parse(country + '-vat-threshold');
			countryInputs[country].taxFreeAllowance = parse(country + '-tax-free-allowance');
			countryInputs[country].taxRates = parseBands(country + '-tax-rates');
			countryInputs[country].socialSecurityFixed = parse(country + '-social-security-fixed');
			countryInputs[country].socialSecurityRates = parseBands(country + '-social-security-rates');
			countryInputs[country].socialSecurityIsExpense =
				$('input[name="' + country + '-social-security-is-expense"]').is(':checked');
		});
		countryInputs.gb.name = "the UK";
		countryInputs.es.name = "Spain";

		xe.pounds = 1;
		xe.euros = parseFloat($('input[name="eurosPerPound"]').val());
	};

	var applyRates = function (brackets, input) {
		return _.reduce(brackets, function (memo, bracket) {
			var inputWithinBracket = Math.max(0, Math.min(input - bracket.from, bracket.to - bracket.from));
			return memo + inputWithinBracket * bracket.rate;
		}, 0);
	};

	var roundCurrency = function (number) {
		return Math.round(number * 100) / 100;
	};

	// Calculate all deductions
	//
	// # Business Inputs (all monthly)
	// business.b2cRevenue         : Total sales to consumers, including VAT
	// business.b2bRevenue         : Total sales to business, excluding VAT
	// business.expenses           : Total expenses
	//
	// # Country Inputs (all yearly)
	// country.vat                 : Percentage of VAT
	// country.vatThreshold        : VAT registration threshold
	// country.taxFreeAllowance    : Tax free allowance for income tax
	// country.taxRates            : Income tax rates (array)
	// country.socialSecurityFixed : Fixed social security payment
	// country.socialSecurityRates : Income dependent social security rates (array)
	// country.socialSecurityIsExpense : True if social security payment is taken before tax
	// 
	// # Output (all monthly)
	// vat
	// preTaxProfit
	// socialSecurity
	// incomeTax
	// totalDeductions
	// netProfit
	var calcDeductions = function (business, country) {
		var output = {};

		// VAT
		if (businessInputs.b2cRevenue * 12 < country.vatThreshold) {
			output.vat = 0;
		} else {
			output.vat = business.b2cRevenue * (1 - 100 / (100 + country.vat));
		}

		output.preTaxProfit =
			business.b2cRevenue + business.b2bRevenue - business.expenses - output.vat;

		var yearlyPreTaxProfit = output.preTaxProfit * 12;

		// Social Security
		var yearlySocialSecurity = country.socialSecurityFixed;
		yearlySocialSecurity += applyRates(country.socialSecurityRates, yearlyPreTaxProfit);
		output.socialSecurity = yearlySocialSecurity / 12;

		// Income Tax
		var yearlyTaxableIncome = yearlyPreTaxProfit;
		if (country.socialSecurityIsExpense) {
			yearlyTaxableIncome = yearlyPreTaxProfit - yearlySocialSecurity;
		}
		yearlyTaxableIncome = Math.max(0, yearlyTaxableIncome - country.taxFreeAllowance);

		console.log(country.code + ' - taxable yearly: ', yearlyTaxableIncome);

		output.incomeTax = applyRates(country.taxRates, yearlyTaxableIncome) / 12;
		output.totalDeductions = output.vat + output.socialSecurity + output.incomeTax;
		output.netProfit = output.preTaxProfit - output.socialSecurity - output.incomeTax;

		return output;
	};

	var scaleValues = function (inputs, factor) {
		var output = {};

		_.each(inputs, function (value, key) {
			output[key] = value * factor;
		});

		return output;
	};

	// Display a friendly message explaining how they'll be better off in one
	// country or another
	var displayBubble = function () {
		var betterCountry,
			worseCountry,
			difference,
			percentage,
			message;

		if (output.gb.netProfit > output.es.netProfit) {
			betterCountry = 'gb';
			worseCountry = 'es';
		} else {
			betterCountry = 'es';
			worseCountry = 'gb';
		}
		
		var betterProfit = output[betterCountry].netProfit,
			worseProfit = output[worseCountry].netProfit,
			betterName = countryInputs[betterCountry].name,
			worseName = countryInputs[worseCountry].name;

		difference = betterProfit - worseProfit;
		percentage = 100 * difference / worseProfit;

		if (worseProfit < 0 && betterProfit < 0) {
			message = 'You will lose €' + Math.round(difference) + ' / month more in ' + worseName;
		} else if (worseProfit < 0) {

			message = 'You will make €' + Math.round(betterProfit) + ' in ' + betterName +
				' instead of losing €' + Math.round(-worseProfit) + ' in ' + worseName;
		} else {
			message = 'You will make a net profit ' + Math.round(percentage) + '% (€' +
					Math.round(difference) + ') higher in ' + betterName;
		}

		$('.compare-net-profit').text(message);
	};

	var calculateEverything = function () {
		clearError();

		// parse inputs
		parseValues();

		// calculate all deductions
		var businessInputsPounds = scaleValues(businessInputs, xe.pounds / xe.euros);
		var outputsPounds = calcDeductions(businessInputsPounds, countryInputs.gb);
		output.gb = scaleValues(outputsPounds, xe.euros / xe.pounds);
		output.es = calcDeductions(businessInputs, countryInputs.es);

		console.log('output: ', JSON.stringify(output, null, '\t'));

		// write output
		_.each(output, function (country, countryCode) {
			_.each(country, function (value, key) {
				$('.' + countryCode + '-output-' + key)
					.text('€' + roundCurrency(value))
					.attr('title', '£' + roundCurrency(value * xe.pounds / xe.euros));
			});
		});

		displayBubble();

	};

	$('input').keyup(calculateEverything);
	$('textarea').keyup(calculateEverything);
	$('input[type="checkbox"]').change(calculateEverything);

	calculateEverything();
});

