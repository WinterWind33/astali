// Copyright (C) 2022 Andrea Ballestrazzi

// Production classes
import 'package:astali/astali_app.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets("The home user interface should have only one settings button",
      (tester) async {
    await tester.pumpWidget(const AstaliApp());

    final settingsButtonFinder = find.byIcon(Icons.settings);

    expect(settingsButtonFinder, findsOneWidget);
  });

  testWidgets("The home user interface should have only one Add Card button",
      (tester) async {
    await tester.pumpWidget(const AstaliApp());

    final addButtonFinder = find.byIcon(Icons.add);

    expect(addButtonFinder, findsOneWidget);
  });
}
