// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

// Production classes
import 'package:astali/astali_app.dart';
import 'package:astali/astali_main_injector.dart';

void main() {
  testWidgets("The home user interface should have only one settings button",
      (tester) async {
    await tester.pumpWidget(const AstaliApp(AstaliMainInjector()));

    final settingsButtonFinder = find.byIcon(Icons.settings);

    expect(settingsButtonFinder, findsOneWidget);
  });
}
